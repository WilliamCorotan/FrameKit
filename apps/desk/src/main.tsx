import { createRoot } from "react-dom/client";
import "./styles.css";
import { DeskApp } from "./app/DeskApp";

createRoot(document.getElementById("root")!).render(<DeskApp />);
