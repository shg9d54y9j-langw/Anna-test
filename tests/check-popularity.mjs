// Prüft, dass die Aktien-Daten erkennen, ob eToros Beliebtheit ein Rang (1 = beliebteste) oder eine Anzahl ist.
// Aufruf: node tests/check-popularity.mjs
import { popularityIsRank } from "../scripts/stock-universe.mjs";

const mk = (s, v) => ({ internalSymbolFull: s, popularityUniques7Day: v });
const rest = Array.from({ length: 50 }, (_, i) => mk(`X${i}`, 10 + i));
if (!popularityIsRank([mk("AAPL", 1), mk("TSLA", 2), ...rest])) throw new Error("Rang nicht erkannt");
if (popularityIsRank([mk("AAPL", 90000), mk("TSLA", 80000), ...rest])) throw new Error("Anzahl nicht erkannt");
console.log("Rang und Anzahl richtig erkannt.");
