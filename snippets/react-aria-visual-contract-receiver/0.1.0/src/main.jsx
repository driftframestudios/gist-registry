import React from "react";
import {createRoot} from "react-dom/client";
import {App} from "./app.jsx";
import "./styles.css";

const root = document.getElementById("receiver-root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
