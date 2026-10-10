# PRD dan Tech Stack Aplikasi Pencatat Pengeluaran

Versi 1.1 | 10 Oktober 2026 | MVP pribadi dan fase kedua Telegram

## 01 Ringkasan produk

Aplikasi web untuk mencatat pengeluaran, pemasukan, dan perpindahan uang antar dompet, lalu meninjau kondisi keuangan bulanan dari HP maupun laptop. Fokus versi pertama adalah pencatatan cepat, perhitungan konsisten, dan data yang dapat diekspor.

**Keputusan utama:** bangun PWA dengan Next.js, TypeScript, Supabase, dan Vercel Hobby. Target biaya infrastruktur Rp0 per bulan selama penggunaan memenuhi ketentuan dan kuota layanan gratis. Biaya pengembangan, koneksi internet, dan perangkat tidak termasuk. [1][2]

### Pengguna dan batas produk

- Pengguna utama: individu yang mencatat transaksi pribadi setiap hari.
- Pilot: 1 sampai 5 pengguna. Anggota keluarga dapat memakai akun masing-masing; data antar akun tetap terpisah.
- Bahasa Indonesia, mata uang IDR tanpa pecahan rupiah, dan zona waktu Asia/Jakarta.
- Satu pengguna dapat memiliki beberapa dompet, misalnya Tunai, Bank, dan E-wallet. Dompet merupakan catatan manual, bukan koneksi ke rekening asli.
- Satu pembukuan dimiliki satu pengguna. Kolaborasi dalam satu dompet keluarga masuk tahap berikutnya.
- Aplikasi digunakan secara personal dan nonkomersial. Perubahan menjadi produk komersial memerlukan evaluasi hosting. [2]

### Masalah yang diselesaikan

Catatan pengeluaran sering tersebar dan terlupakan karena proses input terlalu panjang. Pengguna juga sulit membedakan pengeluaran sesungguhnya dengan perpindahan uang, misalnya isi saldo e-wallet. Aplikasi mempersingkat input dan menghitung ringkasan dari transaksi yang sama dengan riwayat pengguna.

### Target keberhasilan pilot

| Ukuran | Target penerimaan | Cara mengukur |
| --- | --- | --- |
| Kecepatan input | Median maksimal 15 detik untuk transaksi sederhana | Amati 10 percobaan setelah onboarding |
| Akurasi | Seluruh skenario saldo dan laporan wajib lulus | Dataset tetap dengan hasil yang dihitung manual |
| Kemudahan pakai | Minimal 4 dari 5 tugas selesai tanpa bantuan | Login, input, edit, transfer, ekspor |
| Biaya | Rp0 pada paket yang dipilih | Tinjau halaman usage dan billing setiap bulan |

**Prioritas:** P0 adalah MVP web; P1 adalah integrasi Telegram pada fase kedua; P2 adalah pengembangan lanjutan. Angka target di atas merupakan kriteria produk yang perlu diuji.

<!-- pagebreak -->

## 02 Kebutuhan fungsional inti

### F01 Login dan sesi P0

Pengguna masuk menggunakan Google melalui Supabase Auth. Aplikasi membutuhkan akses profil dasar dan email saja. Google OAuth memerlukan konfigurasi consent screen, client ID, dan redirect URL. [4]

**Kriteria penerimaan:** login berhasil membuka onboarding atau dashboard; pembatalan login menampilkan pilihan coba lagi; logout menghapus cache data aplikasi. Pengguna tanpa sesi tidak dapat membaca atau mengubah transaksi melalui API. Setiap akun hanya melihat datanya sendiri.

### F02 Onboarding dan kategori P0

Pada pemakaian pertama, pengguna membuat minimal satu dompet dengan nama, jenis, saldo awal, serta tanggal mulai pencatatan. Aplikasi menyediakan kategori awal seperti Makanan, Transportasi, Belanja, Tagihan, Hiburan, Kesehatan, Gaji, dan Lainnya. Kategori disalin menjadi milik pengguna.

**Kriteria penerimaan:** onboarding dapat dilanjutkan setelah terputus tanpa membuat dompet atau kategori ganda. Pengguna dapat menambah, mengganti nama, dan mengarsipkan kategori. Kategori pemasukan dan pengeluaran terpisah. Tanggal mulai ditampilkan bersama saldo awal agar maknanya jelas.

### F03 Tambah transaksi P0

Pengguna mencatat pengeluaran atau pemasukan dengan nominal, dompet, kategori, tanggal, dan catatan opsional. Jenis awal adalah pengeluaran, tanggal awal adalah hari ini, dan dompet awal adalah dompet terakhir yang dipakai. Form dibuka dari tombol Tambah yang mudah dijangkau di HP.

**Kriteria penerimaan:** nominal wajib berupa rupiah bulat lebih dari nol; catatan maksimal 250 karakter; tanggal tidak boleh melewati hari ini atau mendahului tanggal mulai dompet. Pesan validasi muncul di dekat kolom. Setelah server mengonfirmasi penyimpanan, transaksi muncul dan saldo serta ringkasan diperbarui. Klik Simpan berulang tidak membuat duplikasi.

### F04 Koreksi dan hapus transaksi P0

Pengguna dapat mengubah nominal, dompet, kategori, tanggal, dan catatan. Jenis transaksi tidak diubah melalui edit; untuk mengubah jenis, pengguna menghapus transaksi lama dan membuat yang baru.

**Kriteria penerimaan:** perubahan langsung memengaruhi semua perhitungan terkait setelah berhasil disimpan. Hapus memerlukan konfirmasi yang menyebut nominal dan tanggal. Riwayat yang dihapus tidak masuk laporan. Jika transaksi sudah berubah di perangkat lain, penyimpanan ditolak dengan pesan untuk memuat ulang.

### F05 Kelola dompet P0

Pengguna dapat membuat dan mengganti nama dompet serta mengarsipkan dompet yang tidak lagi digunakan. Saldo dihitung dari saldo awal dan transaksi; saldo tidak ditulis ulang setiap kali ada transaksi.

**Kriteria penerimaan:** dompet yang sudah memiliki transaksi tidak dapat dihapus. Dompet arsip tetap masuk riwayat dan total saldo, tetapi tidak tersedia untuk transaksi baru. Koreksi saldo awal memerlukan konfirmasi; tanggal mulai baru tidak boleh melampaui transaksi paling awal. Saldo negatif diperbolehkan karena catatan bisa belum lengkap.

<!-- pagebreak -->

## 03 Laporan dan pengalaman penggunaan

### F06 Transfer antar dompet P0

Pengguna memilih dompet asal, dompet tujuan, nominal, dan tanggal. Keduanya harus aktif, berbeda, dan dimiliki pengguna yang sama. Transfer disimpan sebagai satu transaksi utuh.

**Kriteria penerimaan:** saldo asal berkurang, saldo tujuan bertambah, dan total semua dompet tetap sama. Transfer tidak dihitung sebagai pemasukan atau pengeluaran. Mengedit atau menghapus transfer memperbarui kedua saldo. Biaya admin dicatat sebagai pengeluaran terpisah pada MVP.

### F07 Dashboard bulanan P0

Dashboard menampilkan pemasukan, pengeluaran, selisih arus kas, pengeluaran per kategori, grafik pengeluaran harian, serta saldo terkini per dompet. Pilihan bulan hanya memengaruhi laporan periode; saldo dompet diberi label Saldo saat ini.

**Kriteria penerimaan:** selisih periode sama dengan pemasukan dikurangi pengeluaran. Saldo awal dan transfer tidak masuk arus kas. Pengguna dapat memilih bulan lain. Bulan kosong menampilkan angka nol serta ajakan menambah transaksi. Ringkasan dihitung dari seluruh data pada periode, bukan hanya halaman transaksi yang sedang terbuka.

### F08 Riwayat dan pencarian P0

Riwayat diurutkan berdasarkan tanggal terbaru dengan urutan tambahan yang stabil. Filter mencakup periode, jenis transaksi, dompet, kategori, dan pencarian catatan. Daftar dimuat 50 transaksi per halaman.

**Kriteria penerimaan:** filter dapat digabung dan direset; pencarian memakai jeda input sekitar 300 milidetik. Filter dompet menemukan transfer masuk maupun keluar. Transfer tidak muncul ketika filter kategori dipilih. Pesan data kosong dibedakan dari gagal memuat data.

### F09 Ekspor CSV P0

Pengguna dapat mengunduh seluruh transaksi atau hasil filter, termasuk data dompet arsip. Kolom meliputi ID, tanggal, jenis, sumber, nominal rupiah, dompet asal atau utama, dompet tujuan, kategori, dan catatan.

**Kriteria penerimaan:** ekspor mencakup semua halaman hasil; format nominal berupa angka rupiah tanpa pemisah ribuan; tanggal memakai YYYY-MM-DD. Koma, kutip, baris baru, dan teks yang menyerupai formula spreadsheet ditangani aman. Jika ada permintaan data yang gagal, aplikasi tidak mengirim file yang seolah lengkap. CSV adalah salinan portabel; fitur impor belum tersedia.

### F10 PWA dan kondisi jaringan P0

Aplikasi responsif dan dapat ditambahkan ke home screen pada perangkat yang mendukung. Manifest, ikon, dan halaman offline disediakan. Saat offline, pengguna mendapat penjelasan bahwa penyimpanan memerlukan koneksi. [5]

**Kriteria penerimaan:** tidak ada klaim transaksi berhasil sebelum respons server. Form yang gagal disimpan tetap ada selama halaman masih terbuka. Tidak ada antrean sinkronisasi offline pada MVP. Aplikasi memuat ulang data saat kembali aktif atau setelah mutasi berhasil.

**Alur utama:** login, buat dompet, tambah transaksi, periksa ringkasan. Navigasi HP terdiri dari Ringkasan, Transaksi, Dompet, dan Pengaturan; tombol Tambah selalu mudah ditemukan.

<!-- pagebreak -->

## 04 Aturan bisnis dan batas MVP

### Aturan perhitungan

Saldo dompet adalah saldo awal ditambah pemasukan dan transfer masuk, lalu dikurangi pengeluaran dan transfer keluar. Selisih arus kas bulanan adalah pemasukan periode dikurangi pengeluaran periode. Total saldo menjumlahkan seluruh dompet, termasuk yang diarsipkan.

Saldo awal berlaku pada awal tanggal mulai pencatatan. Transaksi pada tanggal tersebut diperbolehkan; transaksi sebelumnya ditolak. Tanggal transfer harus memenuhi tanggal mulai kedua dompet. Tanggal bisnis disimpan sebagai tanggal kalender agar tidak bergeser akibat konversi UTC.

Contoh uji berikut memakai saldo awal Tunai Rp500.000 dan Bank Rp1.000.000, keduanya mulai pada hari pertama bulan pengujian.

| Langkah | Tunai | Bank | Pemasukan periode | Pengeluaran periode |
| --- | --- | --- | --- | --- |
| Saldo awal | 500.000 | 1.000.000 | 0 | 0 |
| Makan dari Tunai 25.000 | 475.000 | 1.000.000 | 0 | 25.000 |
| Transfer Bank ke Tunai 100.000 | 575.000 | 900.000 | 0 | 25.000 |
| Gaji ke Bank 2.000.000 | 575.000 | 2.900.000 | 2.000.000 | 25.000 |
| Edit makan menjadi 30.000 | 570.000 | 2.900.000 | 2.000.000 | 30.000 |
| Hapus transfer | 470.000 | 3.000.000 | 2.000.000 | 30.000 |

Pada akhir contoh, total saldo Rp3.470.000 dan selisih arus kas Rp1.970.000. Keduanya berbeda karena saldo awal tidak termasuk pemasukan.

### Kondisi kegagalan yang wajib ditangani

- **Koneksi atau layanan terputus:** tampilkan status gagal atau belum dapat dipastikan, pertahankan form, dan izinkan pengecekan atau pengiriman ulang dengan ID transaksi yang sama.
- **Sesi berakhir:** hentikan pengiriman data dan arahkan pengguna untuk login kembali. Jangan terus menampilkan data akun lama setelah berganti akun.
- **Data sudah berubah:** tolak edit yang memakai versi lama; tampilkan data terkini sebelum pengguna mencoba lagi.
- **Kategori atau dompet diarsipkan:** riwayat tetap dapat dibaca. Edit boleh mempertahankan referensi arsip yang sudah ada, tetapi tidak boleh memilih referensi arsip baru.

### Pengembangan setelah MVP

P1 menjadi fase kedua yang diprioritaskan: integrasi Telegram agar pengguna dapat mencatat transaksi lewat chat. Scope mencakup menghubungkan akun, parsing teks, konfirmasi satu ketukan, serta penyimpanan ke pembukuan yang sama. Rinciannya ada pada bagian 10 sampai 12.

P2 mencakup anggaran, transaksi berulang, impor CSV, dan pembukuan keluarga bersama. AI untuk memahami kalimat, foto struk, dan OCR dievaluasi kemudian. Sinkronisasi bank, WhatsApp, multi mata uang, utang piutang, pembagian tagihan, aplikasi native, serta pencatatan offline penuh berada di luar MVP.

<!-- pagebreak -->

## 05 Tech stack yang direkomendasikan

| Lapisan | Teknologi | Peran dalam MVP |
| --- | --- | --- |
| Aplikasi | Next.js App Router dan TypeScript | Routing, app shell, manifest, dan struktur aplikasi |
| Antarmuka | React, Tailwind CSS, shadcn/ui | Form dan komponen responsif dengan perilaku konsisten |
| Data dari server | TanStack Query | Query, cache per akun, pagination, dan invalidasi setelah mutasi |
| Form | React Hook Form dan Zod | Pengelolaan form dan validasi input |
| Grafik | Recharts | Grafik harian dan ringkasan kategori |
| Backend terkelola | Supabase dan supabase-js | Auth, API data, dan pemanggilan fungsi PostgreSQL |
| Database | PostgreSQL di Supabase | Transaksi, relasi, constraint, agregasi, dan RLS |
| Login | Supabase Auth dengan Google OAuth | Identitas pengguna tanpa alur email aplikasi pada MVP |
| PWA | Manifest Next.js dan service worker minimal | Instalasi home screen dan halaman offline |
| Format data | Intl, BigInt, dan string tanggal ISO | Format rupiah dan perhitungan bilangan bulat |
| Pengujian | Vitest, Testing Library, Playwright | Aturan bisnis, perilaku form, dan alur kritis |
| Pengembangan dan deploy | pnpm, Git, Supabase CLI, Vercel Hobby | Dependensi, migration, pengujian lokal, dan deployment |

Gunakan rilis stabil yang kompatibel saat implementasi, kemudian kunci versinya melalui lockfile.

### Alasan pemilihan

Next.js sesuai dengan pengalaman pengembang dan menyediakan struktur routing serta PWA. Supabase menggabungkan database, autentikasi, dan API sehingga pengembang tidak perlu memelihara server aplikasi tersendiri. Dashboard pribadi tidak memerlukan SEO; data pengguna dimuat di browser sesudah login.

TanStack Query menjadi satu tempat pengelolaan cache data server. Query key selalu menyertakan ID pengguna dan filter, lalu query terkait diinvalidasi setelah perubahan. State lokal dan URL cukup untuk form, modal, dan filter; global store tambahan belum diperlukan. [7]

**Implementasi inti:** gunakan supabase-js untuk akses data. Buat SQL migration dan hasilkan tipe database. Backend Express, Prisma, Redis, message queue, serta layanan AI belum menjadi kebutuhan MVP.

### Efisiensi query

Indeks awal mencakup transactions(user_id, occurred_on DESC, created_at DESC, id DESC), transaksi per account_id dan to_account_id, serta foreign key kategori. Agregasi berjalan di database. Hindari polling terus-menerus; refetch dilakukan saat fokus kembali, perubahan filter, dan mutasi berhasil. Penambahan indeks pencarian mengikuti hasil pengukuran.

<!-- pagebreak -->

## 06 Arsitektur dan model data

### Batas tanggung jawab

Browser memuat aplikasi Next.js dari Vercel. Login dikelola Supabase Auth. Browser yang sudah login memanggil RPC melalui supabase-js; PostgreSQL memvalidasi data, menerapkan RLS, dan menghitung agregasi. Browser hanya menampilkan hasil dan mengelola interaksi. Data pengguna tidak dirender pada server Next.js dalam MVP.

Simpan tabel bisnis dalam schema app_data yang tidak diekspos ke Data API. Ekspos schema api yang hanya berisi RPC. Role authenticated memperoleh izin minimum ke objek yang dibutuhkan fungsi invoker; akses tabel REST langsung tidak dibuka. Seluruh pembacaan uang dan perubahan data melewati kontrak RPC. [11]

Pengecekan sesi di antarmuka digunakan untuk pengalaman navigasi. Otorisasi sesungguhnya berjalan di database. Kunci publishable boleh ada di aplikasi dengan RLS dan grants yang benar; service role atau secret key tidak boleh ada di bundle browser. [6]

### Entitas inti

| Tabel | Kolom utama | Ketentuan |
| --- | --- | --- |
| profiles | id UUID, display_name, timezone, currency, data_version | id merujuk auth.users; data_version bertambah ketika data bisnis berubah |
| accounts | id UUID, user_id, name, type, opening_balance_rupiah bigint, opened_on date, archived_at | type cash, bank, atau ewallet; saldo berjalan dihitung dari transaksi |
| categories | id UUID, user_id, name, type, seed_key, archived_at | type income atau expense; seed_key unik per pengguna untuk kategori awal |
| transactions | id UUID, user_id, type, amount_rupiah bigint, account_id, to_account_id, category_id, occurred_on date, note, version, source | type income, expense, atau transfer; nominal selalu positif |

Semua entitas memiliki created_at dan updated_at bertipe timestamptz. profiles memakai id sebagai pemilik; tabel bisnis lain memakai user_id. Versi transaksi meningkat saat edit. source bernilai web pada MVP. UUID dibuat sekali per input dan digunakan kembali saat retry.

### Integritas data

- income dan expense wajib memiliki account_id dan category_id dengan jenis kategori yang cocok; to_account_id harus kosong.
- transfer wajib memiliki dua account berbeda; category_id harus kosong. Satu baris merepresentasikan kedua sisi sehingga penyimpanan dan penghapusan bersifat atomik.
- Gunakan foreign key gabungan dengan user_id agar transaksi tidak dapat merujuk dompet atau kategori akun lain. Identitas pemilik tidak boleh diubah.
- Terapkan constraint atau trigger database untuk nominal, jenis, tanggal, kepemilikan, referensi arsip, dan panjang catatan. Validasi browser mempercepat umpan balik; database tetap memutuskan valid atau tidak.

### Representasi uang

Simpan rupiah sebagai bigint dan hindari floating point. Input, parameter RPC, dan seluruh nilai uang pada respons API memakai string digit; fungsi baca melakukan cast ke text, termasuk hasil SUM. Browser memakai BigInt saat membutuhkan aritmetika atau format, dan menyimpan nilai cache sebagai string agar aman diserialisasi. Validasi rentang bigint pada database; jangan mengubah nilai besar menjadi Number.

<!-- pagebreak -->

## 07 Kontrak akses data dan keamanan

### Operasi aplikasi

| Operasi | Kontrak ringkas | Ketentuan |
| --- | --- | --- |
| bootstrap_user | Membuat profil dan kategori awal | Idempotent berdasarkan pengguna dan seed_key kategori |
| RPC dompet dan kategori | Buat, ubah, dan arsipkan data | ID klien untuk retry create; validasi referensi dan tanggal di database |
| list_transactions | Filter, cursor, limit maksimal 50 | Urutan occurred_on, created_at, id menurun; uang sebagai string |
| get_dashboard | Awal inklusif, akhir eksklusif | Agregasi seluruh periode, tanpa transfer dan saldo awal |
| get_accounts | Dompet dan saldo saat ini | Termasuk dompet arsip; uang sebagai string |
| create_transaction | ID klien dan payload tervalidasi | Duplicate ID dengan payload sama mengembalikan hasil lama |
| update_transaction | ID, expected_version, perubahan | Update atomik hanya jika versi sesuai; versi naik satu |
| delete_transaction | ID dan expected_version | Konfirmasi di UI; penghapusan memengaruhi kedua sisi transfer |
| export_transactions | Filter dan pagination internal | Urutan stabil, memeriksa semua halaman sebelum membuat file |

Pada MVP web, gunakan RPC PostgreSQL dengan SECURITY INVOKER dan eksekusi hanya oleh authenticated. Fungsi memperoleh identitas dari auth.uid(); parameter user_id dari browser tidak dipercaya. RPC dengan SECURITY DEFINER hanya digunakan jika benar-benar diperlukan dan harus menambahkan pemeriksaan identitas, grants sempit, serta search_path tetap. [8]

Jika ID yang sama dikirim dengan payload berbeda, kembalikan konflik. Saat respons simpan hilang, periksa transaksi berdasarkan ID terlebih dahulu sebelum mencoba ulang. Untuk ekspor, baca profiles.data_version sebelum dan sesudah seluruh halaman. Trigger menaikkan revisi tersebut untuk setiap mutasi data bisnis, termasuk hapus dan perubahan nama; ekspor dibatalkan bila revisi berbeda.

### Isolasi dan perlindungan data

- Aktifkan RLS pada semua tabel bisnis. Untuk SELECT, UPDATE, dan DELETE, pemilik harus cocok dengan auth.uid(); INSERT dan hasil UPDATE harus lulus WITH CHECK. UPDATE juga memerlukan kebijakan SELECT yang sesuai. [6]
- Batasi grants tabel serta fungsi. Terapkan constraint meskipun klien melewati UI. RPC edit melakukan compare and update secara atomik; tabel bisnis tidak tersedia melalui endpoint REST langsung.
- Jika memakai view, gunakan security_invoker agar kebijakan tabel dasar tetap berlaku. Jangan memberikan akses anonim ke data pengguna. [6]
- Kosongkan cache saat logout atau pergantian akun. Jangan menaruh data transaksi di cache bersama pada server atau CDN. Service worker hanya menyimpan aset publik dan halaman offline.
- Log cukup memuat jenis operasi, kode error, durasi, dan ID korelasi. Jangan merekam token, nominal, catatan transaksi, atau isi CSV. Catatan pengguna dirender sebagai teks.

<!-- pagebreak -->

## 08 Kualitas dan operasional

### Persyaratan nonfungsional

| Area | Target MVP | Verifikasi |
| --- | --- | --- |
| Waktu tampil | LCP maksimal 2,5 detik pada skenario mobile yang disepakati | Ukur di Android kelas menengah dan koneksi 4G; simpan kondisi uji |
| Respons simpan | p95 maksimal 2 detik saat layanan aktif | Ukur sekurangnya 100 operasi pada dataset 10.000 transaksi |
| Tata letak | Tetap dapat dipakai mulai lebar 360 piksel | Periksa HP dan laptop tanpa horizontal scroll utama |
| Aksesibilitas | Label, fokus keyboard, pesan error, dan grafik terbaca | Uji keyboard; tabel atau teks pendamping grafik |
| Isolasi akun | Tidak ada baca atau tulis lintas pengguna | Uji dua akun melalui API, bukan hanya UI |
| Pemulihan | Data dapat dikembalikan dari cadangan operator | Latihan restore di lingkungan terpisah sebelum pilot |

Target performa merupakan sasaran pengembangan saat layanan sehat, bukan jaminan ketersediaan dari paket gratis. Uji login, input, ekspor, dan instalasi PWA di Chrome Android serta Safari iPhone yang tersedia untuk pilot.

### Pengujian yang wajib sebelum rilis

1. Dataset saldo pada bagian 04, perubahan bulan, transfer lintas bulan, serta saldo awal.
2. RLS dengan user A, user B, dan tanpa sesi; akses lintas pemilik melalui ID dompet, kategori, fungsi, serta view harus gagal.
3. Klik ganda dan retry setelah timeout; hanya satu transaksi tersimpan. Payload berbeda dengan ID sama menghasilkan konflik.
4. Edit bersamaan dari dua perangkat; hanya versi yang masih valid dapat disimpan.
5. Nilai rupiah besar, nol, negatif, tanggal sebelum dompet dibuka, dan tanggal masa depan.
6. Ekspor lebih dari 50 baris, filter transfer, teks berkoma atau berkutip, serta formula spreadsheet.
7. Logout dan login akun lain; tidak ada data lama pada cache, layar, atau service worker.

### Cadangan dan pemulihan

Backup otomatis tidak termasuk dalam paket Supabase Free. Operator menjalankan dump database mingguan dan sebelum migration berisiko, menyimpan salinan terenkripsi di luar proyek, lalu menguji pemulihan schema, data, dan pemetaan identitas pengguna. CSV pengguna melengkapi cadangan tersebut, tetapi tidak menggantikannya. [1][9]

Target internal: potensi kehilangan data maksimal tujuh hari jika prosedur mingguan berjalan; upaya pemulihan dalam satu hari kerja. Ini komitmen operasional yang perlu disanggupi pemilik aplikasi, bukan SLA. Runbook mencakup restore proyek yang dijeda, pengecekan kuota, rollback aplikasi, serta pemulihan database.

### Lingkungan pengembangan

Simpan migration, seed sintetis, dan generated database types di Git. Gunakan Supabase lokal untuk pengembangan; jika perangkat terbatas, pakai proyek development terpisah sesuai kuota. Preview deployment tidak boleh menulis ke database produksi. Simpan konfigurasi Google OAuth dan kredensial administratif di pengaturan layanan atau secret yang sesuai.

<!-- pagebreak -->

## 09 Biaya dan rencana pengembangan

### Anggaran operasional

| Komponen | Rencana | Biaya target | Batas yang relevan |
| --- | --- | --- | --- |
| Hosting | Vercel Hobby | Rp0 per bulan | Personal nonkomersial; ada kuota penggunaan [2] |
| Database dan Auth | Supabase Free | Rp0 per bulan | Database 500 MB, egress 5 GB, 50.000 MAU; maksimal 2 proyek aktif [1] |
| Domain | Subdomain bawaan hosting | Rp0 tambahan | Custom domain tidak dibeli pada MVP |
| Login | Google OAuth melalui Supabase | Dalam rancangan gratis | Profil dasar; tidak memakai SMTP aplikasi [3][4] |
| Lampiran dan AI | Tidak digunakan pada MVP | Rp0 | Foto struk, OCR, dan AI dievaluasi kemudian |

Ketentuan diperiksa pada 9 Oktober 2026 dan dapat berubah. MAU adalah pengguna aktif bulanan, bukan jaminan kapasitas transaksi. Tinjau pemakaian setiap bulan; gunakan ambang internal 70 persen dari kuota database atau egress untuk evaluasi. Jangan mengaktifkan add-on atau upgrade berbayar secara otomatis.

Supabase dapat menjeda proyek Free dengan aktivitas rendah selama tujuh hari; pemilik perlu memulihkan proyek dari dashboard. UI harus menjelaskan gangguan tanpa mengklaim data sudah tersimpan. Vercel Hobby juga dapat membatasi fitur ketika kuota terlampaui. [2][10]

### Urutan pengerjaan

Estimasi untuk satu frontend engineer yang terbiasa dengan React dan Next.js, bekerja penuh waktu. Integrasi OAuth, pengujian database, dan revisi UX dapat mengubah durasi.

| Tahap | Hasil | Perkiraan hari kerja |
| --- | --- | --- |
| Fondasi | Struktur proyek, schema, RLS, login, onboarding | 2 sampai 3 |
| Transaksi | Dompet, kategori, CRUD, transfer, konflik, idempotensi | 3 sampai 4 |
| Ringkasan | Dashboard, filter, pagination, ekspor | 2 sampai 3 |
| Kesiapan pilot | PWA, pengujian kritis, backup, deployment | 2 sampai 3 |
| Evaluasi | Pilot satu minggu kalender dan perbaikan utama | 1 sampai 2 hari perbaikan |

Total perkiraan pengerjaan aktif 10 sampai 15 hari kerja, ditambah masa observasi pilot. Jadwal part time perlu disesuaikan dengan waktu yang tersedia.

### Syarat rilis dan keputusan berikutnya

Pilot dimulai setelah seluruh P0 dan pengujian wajib lulus, tanpa masalah kritis terbuka. Pemilik menguasai akun serta konfigurasi produksi. Migration sudah diuji dan data uji tidak ikut terbawa.

Setelah pilot MVP, lanjutkan fase kedua integrasi Telegram sesuai bagian 10 sampai 12. Ketersediaan tanpa jeda, akses publik, dan penggunaan komersial memerlukan evaluasi ulang anggaran serta hosting.

<!-- pagebreak -->

## 10 Input transaksi melalui Telegram

Fase kedua memprioritaskan pencatatan lewat chat pribadi dengan bot. Pengguna tetap memakai akun aplikasi yang sama; transaksi dari Telegram masuk ke dompet, riwayat, dan laporan yang sama. Input berupa kalimat singkat tanpa perintah khusus. Versi awal menerima satu transaksi teks per pesan.

### Contoh interaksi yang didukung

| Pesan pengguna | Hasil yang ditawarkan bot |
| --- | --- |
| beli nasi 20rb pakai tunai | Pengeluaran Rp20.000, kategori Makanan, dompet Tunai |
| bensin 50k pakai BCA | Pengeluaran Rp50.000, kategori Transportasi, dompet beralias BCA |
| gaji 5jt ke BCA | Pemasukan Rp5.000.000, kategori Gaji, dompet beralias BCA |
| kopi 18rb kemarin | Pengeluaran Rp18.000, tanggal kemarin, dompet default yang ditampilkan |

Nominal mendukung angka rupiah penuh, rb, k, dan jt; format seperti 12,5rb diproses menjadi Rp12.500. Alias kategori dan dompet hanya menunjuk data pengguna tersebut. Tanggal tanpa keterangan memakai tanggal pesan dikirim dalam Asia/Jakarta; kemarin dihitung dari tanggal pesan, bukan waktu webhook diproses.

### F11 Hubungkan akun P1

Dari Pengaturan aplikasi, pengguna memilih Hubungkan Telegram lalu membuka tautan bot dan menekan Start. Web menampilkan identitas Telegram yang meminta koneksi; pengguna menyetujui dari sesi web yang sudah login. Setelah tersambung, pengguna memilih dompet default untuk input chat. Deep link Telegram membawa kode pairing satu kali. [13]

**Kriteria penerimaan:** satu akun aplikasi terhubung ke satu identitas Telegram aktif; kode berlaku lima menit dan tidak dapat digunakan ulang. Koneksi tidak ditentukan dari username yang dapat berubah. Pengguna dapat memutus koneksi dari web atau bot dengan konfirmasi; draft yang belum disimpan ikut dibatalkan.

### F12 Catat lewat chat P1

Bot mengubah pesan menjadi draft dan membalas ringkasan jenis, nominal, kategori, dompet, tanggal, serta catatan. Tersedia tombol Simpan, Ubah, dan Batal. Nilai default atau hasil pencocokan kategori selalu terlihat sebelum pengguna menekan Simpan. Draft kedaluwarsa setelah sepuluh menit.

**Kriteria penerimaan:** data hanya ditulis setelah pengguna menekan Simpan dan database berhasil melakukan commit. Klik tombol berulang menghasilkan transaksi yang sama. Jika nominal, kategori, atau dompet belum jelas, bot meminta pilihan. Pesan beli 3 burger 3000 harus diklarifikasi sebagai harga total atau harga per burger. Setelah tersimpan, bot memberikan nomor transaksi dan tautan ke web; dashboard mengikuti saat refetch berikutnya.

### F13 Bantuan dan koreksi P1

Perintah /bantuan menampilkan contoh; /batal membatalkan draft aktif; /terakhir menampilkan transaksi terbaru milik pengguna. Koreksi transaksi yang sudah disimpan dilakukan dari web pada rilis Telegram pertama. Mengedit atau menghapus pesan Telegram tidak otomatis mengubah catatan keuangan. Foto, voice note, pesan grup, transfer lewat chat, serta beberapa transaksi dalam satu pesan ditunda.

<!-- pagebreak -->

## 11 Arsitektur integrasi Telegram

### Tambahan pada tech stack

Gunakan Telegram Bot API melalui fetch TypeScript, Next.js Route Handler sebagai webhook di Vercel, serta Supabase PostgreSQL untuk state dan penyimpanan. Endpoint rencana adalah POST /api/integrations/telegram/webhook. Bot dibuat melalui BotFather saat fase implementasi. Route Handler memproses permintaan HTTP tanpa server bot yang harus terus menyala. [12][14]

Parser TypeScript memakai pola nominal, kata kunci jenis transaksi, serta alias kategori dan dompet; Zod memvalidasi hasilnya. Parser ini mendukung pola yang dinyatakan dalam contoh, bukan pemahaman seluruh bahasa bebas. AI menjadi adapter opsional setelah kebutuhan dan biaya dinilai; hasil AI tetap melewati validasi dan konfirmasi yang sama.

### Fondasi yang disiapkan sejak MVP

Pisahkan validasi dan penyimpanan transaksi dari komponen UI. RPC web dan RPC bot memanggil logika inti transaksi yang sama agar nominal, tanggal, kepemilikan dompet, dan idempotensi tidak berbeda. Tambahkan transactions.source dengan nilai web pada MVP dan telegram ketika fase kedua aktif. Kunci idempotensi sumber Telegram ditambahkan pada migration fase kedua.

### Data tambahan pada fase kedua

| Entitas | Data dan tanggung jawab |
| --- | --- |
| telegram_links | app user, bot_id, telegram_user_id, private_chat_id, dompet default, status dan revoked_at; pasangan aktif harus unik |
| telegram_link_tokens | Hash kode acak, app user, kandidat identitas Telegram, expires_at dan used_at; aktivasi memerlukan konfirmasi web |
| telegram_drafts | Pemilik dan link, pesan asal, payload tervalidasi, version, status, expires_at serta transaction_id hasil commit |
| telegram_events | bot_id dan update_id unik, status pemrosesan, hasil serta status balasan; menyimpan metadata minimum untuk retry |

ID Telegram disimpan sebagai bigint dan dikirim sebagai string pada batas API. Draft dan tabel integrasi tidak dapat dibaca secara publik. Kode pairing dibuat acak dengan entropi tinggi, disimpan sebagai hash, dan dihapus ketika kedaluwarsa. Batasi masa simpan draft; jangan menyalin seluruh riwayat chat ke log.

### Identitas bot dan akses database

Webhook wajib memeriksa X-Telegram-Bot-Api-Secret-Token, jenis private chat, serta identitas pengirim. Kode rahasia webhook berbeda dari token bot. Token bot dan kredensial Supabase administratif hanya berada pada server. [12]

Bot tidak memiliki JWT pengguna Google. Sediakan RPC khusus server dengan hak eksekusi terbatas yang mencari koneksi aktif dari identitas Telegram terverifikasi. RPC ini memeriksa pemilik draft, versi, masa berlaku, dan dompet sebelum commit; user_id tidak pernah diambil dari teks chat. Service role dapat melewati RLS, sehingga pemeriksaan kepemilikan eksplisit wajib dilakukan. RPC web tetap memakai auth.uid() dan RLS seperti pada MVP. [6][8]

<!-- pagebreak -->

## 12 Keandalan dan rilis Telegram

### Penyimpanan tanpa transaksi ganda

Telegram dapat mengirim ulang webhook. Deduplikasi penerimaan memakai pasangan bot_id dan update_id; penyimpanan transaksi juga memiliki kunci unik dari bot, private chat, dan message_id pesan asal. Jangan menganggap update selalu datang berurutan. [12]

Tombol Simpan membawa referensi draft dan versi; server memeriksa pengirim, chat, serta koneksi aktif pada setiap aksi. Dalam satu transaksi database, kunci draft, validasi kembali, simpan transaksi, dan ubah status draft menjadi committed. Klik kedua membaca hasil yang sudah ada. Bukti idempotensi tetap ada ketika transaksi kemudian dihapus agar pesan lama tidak membuatnya kembali.

Simpan state pemrosesan sebelum memberi respons berhasil pada webhook. Pada pemrosesan sinkron versi awal, kegagalan sementara database atau pengiriman balasan menghasilkan respons yang dapat dicoba ulang. Retry melanjutkan state yang tersimpan; transaksi yang sudah committed tidak diinsert ulang. Respons keuangan berhasil hanya dikirim setelah commit. Balasan bot mungkin berulang ketika hasil pengiriman tidak pasti; catatan transaksi tetap satu.

### Gangguan layanan dan batas biaya

Target biaya tambahan fase kedua tetap Rp0 untuk pilot kecil dengan parser berbasis aturan dan pemakaian yang masih masuk kuota hosting serta database. Pantau jumlah invocation, egress, ukuran tabel event, dan laju pesan; tidak ada ketergantungan layanan AI atau n8n pada rilis pertama.

Jeda proyek Supabase atau gangguan webhook tetap dapat menghambat input. Telegram menyimpan update yang belum diterima maksimal 24 jam; pengiriman ulang webhook tidak boleh dianggap sebagai antrean tanpa batas. Setelah gangguan panjang, pengguna memeriksa /terakhir atau riwayat web sebelum mengirim ulang transaksi yang belum tercatat. Kegagalan membalas tidak selalu berarti transaksi gagal disimpan. [10][12]

### Pengujian dan syarat rilis

- Uji contoh teks termasuk rb, k, jt, format desimal, kemarin di sekitar tengah malam, serta pesan dengan dua nominal. Input ambigu tidak boleh langsung disimpan.
- Uji dua pengguna, kode pairing kedaluwarsa atau digunakan ulang, konfirmasi web, serta aksi setelah koneksi dicabut. Draft pengguna lain tidak dapat dikonfirmasi.
- Kirim ulang update, klik Simpan bersamaan, dan putus koneksi sesudah commit. Satu draft menghasilkan maksimal satu transaksi; versi draft lama tidak dapat disimpan.
- Uji nominal dan tanggal melanggar aturan MVP, dompet arsip, token webhook salah, pesan grup, serta callback yang dipalsukan.
- Pastikan transaksi bersumber Telegram muncul pada riwayat, saldo, laporan, dan ekspor web dengan perhitungan yang sama seperti input web.

**Estimasi fase kedua:** tambahan 5 sampai 8 hari kerja untuk pairing, parser, bot, retry, dan pengujian, lalu pilot satu minggu kalender. Estimasi ini terpisah dari 10 sampai 15 hari kerja MVP web; validasi saat implementasi sebelum menentukan tanggal rilis.

<!-- pagebreak -->

## 13 Referensi teknis

Sumber resmi berikut mendasari kemampuan platform dan batas layanan. Scope, target, arsitektur, serta estimasi durasi merupakan rancangan produk. Referensi 1 sampai 11 diperiksa pada 9 Oktober 2026; referensi integrasi Telegram 12 sampai 14 pada 10 Oktober 2026.

1. **Supabase Pricing.** Kuota Free, fitur Auth, batas proyek, dan backup.
   https://supabase.com/pricing

2. **Vercel Hobby Plan.** Ketentuan personal nonkomersial dan perilaku saat kuota terlampaui.
   https://vercel.com/docs/plans/hobby

3. **Supabase Custom SMTP.** Pembatasan email bawaan dan kebutuhan pengiriman email produksi.
   https://supabase.com/docs/guides/auth/auth-smtp

4. **Supabase Sign in with Google.** Konfigurasi Google OAuth dan scope profil dasar.
   https://supabase.com/docs/guides/auth/social-login/auth-google

5. **Next.js Progressive Web Applications.** Manifest, instalasi, dan komponen PWA.
   https://nextjs.org/docs/app/guides/progressive-web-apps

6. **Supabase Row Level Security.** Kebijakan akses per pengguna dan keamanan view.
   https://supabase.com/docs/guides/database/postgres/row-level-security

7. **TanStack Query Invalidation.** Invalidasi dan pemuatan ulang data setelah perubahan.
   https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation

8. **Supabase Database Functions.** RPC, SECURITY INVOKER, SECURITY DEFINER, dan grants.
   https://supabase.com/docs/guides/database/functions

9. **Supabase Database Backups.** Cadangan dan rekomendasi ekspor untuk paket gratis.
   https://supabase.com/docs/guides/platform/backups

10. **Supabase Project Pausing.** Jeda karena aktivitas rendah dan pemulihan proyek.
    https://supabase.com/docs/guides/platform/free-project-pausing

11. **Supabase Using Custom Schemas.** Pemilihan schema yang diekspos dan izin akses.
    https://supabase.com/docs/guides/api/using-custom-schemas

12. **Telegram Bot API.** Webhook, update, tombol interaksi, dan pengiriman balasan.
    https://core.telegram.org/bots/api

13. **Telegram Bot Features.** Deep link untuk menghubungkan akun dan interaksi bot.
    https://core.telegram.org/bots/features#deep-linking

14. **Next.js Route Handlers.** Endpoint HTTP pada App Router.
    https://nextjs.org/docs/app/getting-started/route-handlers
