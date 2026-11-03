import { createRoot } from "react-dom/client";
import App from "./App";
import "./generated/markdown-themes.css";
import "./styles.css";
import "@fontsource/open-sans-condensed/latin-300.css";
import "@fontsource/open-sans-condensed/latin-300-italic.css";
import "@fontsource/open-sans-condensed/latin-700.css";
import "@fontsource/arimo/latin-700.css";
createRoot(document.getElementById("root")!).render(<App />);
