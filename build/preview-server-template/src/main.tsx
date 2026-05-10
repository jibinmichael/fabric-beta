import React from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import Generated from "./Generated"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Generated />
  </React.StrictMode>,
)
