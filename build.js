#!/usr/bin/env node

/**
 * build.js — Inlines all JS and CSS into a single docs/index.html for deployment.
 *
 * Usage: node build.js
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DOCS = path.join(__dirname, "docs");

// Ensure docs directory exists
if (!fs.existsSync(DOCS)) {
    fs.mkdirSync(DOCS, { recursive: true });
}

// Read the source HTML
let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

// Inline CSS: replace <link rel="stylesheet" href="css/style.css">
const cssPath = path.join(SRC, "css", "style.css");
if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, "utf8");
    html = html.replace(
        /<link\s+rel="stylesheet"\s+href="css\/style\.css"\s*\/?>/,
        "<style>\n" + css + "\n</style>"
    );
}

// Inline JS: replace each <script src="js/..."> tag
const jsFiles = [
    "constants.js",
    "deviceCache.js",
    "healthService.js",
    "rootCauseEngine.js",
    "diagnosticTimeline.js",
    "fleetDashboard.js",
    "deviceDiagnostics.js",
    "main.js"
];

jsFiles.forEach(function (filename) {
    const jsPath = path.join(SRC, "js", filename);
    if (fs.existsSync(jsPath)) {
        const js = fs.readFileSync(jsPath, "utf8");
        const regex = new RegExp(
            '<script\\s+src="js/' + filename.replace(".", "\\.") + '"\\s*><\\/script>'
        );
        html = html.replace(regex, "<script>\n" + js + "\n</script>");
    }
});

// Write the inlined HTML
fs.writeFileSync(path.join(DOCS, "index.html"), html, "utf8");

// Copy icon
const iconSrc = path.join(SRC, "images", "icon.svg");
const iconDest = path.join(DOCS, "images", "icon.svg");
const imagesDir = path.join(DOCS, "images");
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}
if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDest);
}

console.log("Build complete: docs/index.html (" + Math.round(fs.statSync(path.join(DOCS, "index.html")).size / 1024) + " KB)");
