import "./styles.css";
import { LedgerState } from "./state/ledger";
import { requiredElement } from "./ui/dom";
import { mountLedger } from "./ui/render";

const teardown = mountLedger(requiredElement<HTMLDivElement>("app"), new LedgerState());
window.addEventListener("pagehide", teardown, { once: true });
