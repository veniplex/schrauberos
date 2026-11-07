// Stufe „asan“: derselbe Prüfer mit AddressSanitizer, UndefinedBehaviorSanitizer und LeakSanitizer gebaut (dynamisch gelinkt, nur im Test) – Goldkorpus, Mutationen und
// Parser-Differential laufen unverändert darüber. Ein Fund (Abbruch, Exit-Code ≠ erwartet) ist ein Fehler.
import { corpusStage } from "./stage-corpus.mjs";
import { mutationStage } from "./stage-mutation.mjs";
import { parserStage } from "./stage-parser.mjs";

export async function asanStage(log) {
  process.env.SOS_SANITIZE = "1";
  process.env.ASAN_OPTIONS = "detect_leaks=1:abort_on_error=0:halt_on_error=1";
  process.env.UBSAN_OPTIONS = "print_stacktrace=1:halt_on_error=1";
  process.env.PARSER_COUNT = process.env.PARSER_COUNT ?? "800";
  try {
    log("-- Goldkorpus unter ASAN/UBSAN/LSAN");
    const a = await corpusStage(log);
    log("-- Mutationen unter ASAN/UBSAN/LSAN");
    const b = await mutationStage(log);
    log("-- Parser-Differential unter ASAN/UBSAN/LSAN");
    const c = await parserStage(log);
    return a && b && c;
  } finally {
    delete process.env.SOS_SANITIZE;
  }
}
