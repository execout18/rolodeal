import React from "react";
import { createRoot } from "react-dom/client";
import Rolodeal from "./Rolodeal.jsx";
import { persistStorage } from "./lib/storage";
import "./index.css";

// Ask the browser not to evict the deck under storage pressure.
persistStorage();

// Register the service worker so the app opens and reads offline.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is a nice-to-have, not a blocker */
    });
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Rolodeal />
  </React.StrictMode>
);
