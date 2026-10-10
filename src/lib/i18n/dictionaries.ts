import { en } from "./dictionary-en";
import { type Dictionary, id } from "./dictionary-id";
import type { Locale } from "./locales";

export const DICTIONARIES: Record<Locale, Dictionary> = { id, en };
