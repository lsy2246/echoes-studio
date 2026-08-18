import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CmsApp } from "./web/CmsApp";
import "cherry-markdown/dist/cherry-markdown.css";
import "./web/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("CMS root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <CmsApp />
  </StrictMode>,
);
