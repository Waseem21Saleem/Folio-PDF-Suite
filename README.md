# 📄 Folio: The Daily PDF Suite

![Folio Cover](https://cdn-icons-png.flaticon.com/512/1644/1644129.png)

**Folio** is a lightning-fast, fully offline browser-based Progressive Web App (PWA) designed to handle all your daily PDF tasks. Whether you need to sign a document, merge a few files, delete a blank page, or seamlessly edit text, Folio does it all right in your browser—without sending your private files to a server.

## 🤖 Wait, what is "Vibe Coding"?

This entire application was **vibe coded**. 

What does that mean? It means this project was built through a purely collaborative, iterative conversation with AI (**Gemini** and **Claude**). I needed a helpful, everyday tool to deal with PDFs without paying for expensive software or uploading sensitive documents to shady websites. So, I sat down, described the vibes, the features, and the UI I wanted, and worked alongside the AI to manifest it into reality. 

No complex build steps, no heavy Node modules, no bloated frameworks—just pure, beautifully crafted HTML, CSS, and Vanilla JavaScript.

## ✨ Features

- **📝 Edit PDF:** Add text with full formatting (Bold, Italic, Underline), draw freehand, use a multiply-blend highlighter, insert images, and drop custom or preset stamps (like "APPROVED" or "CONFIDENTIAL").
- **🔍 Smart Text Scanner:** Click on any original text in your PDF to instantly detect its font family, size, and exact color so you can seamlessly match your new edits.
- **🗂️ Organize Pages:** View your document as a grid of thumbnails. Drag to rearrange pages, delete the ones you don't need, and preview pages in full-screen.
- **🔗 Merge PDFs:** Drag and drop multiple PDF files to combine them into one single, continuous document.
- **✂️ Extract Pages:** Select specific pages from a massive PDF and instantly export them into a brand-new file.
- **📤 Cross-Tool Transfer:** Seamlessly move a document from the Editor to the Extractor or the Organizer without having to save and re-upload it.
- **📱 PWA Ready:** Install Folio directly to your iOS, Android, Mac, or Windows device. It acts exactly like a native app and works **100% offline**.

## 🔒 Privacy First

Because this tool was built for daily, real-world utility, **privacy is paramount**. 
Folio relies completely on client-side JavaScript. **Your PDFs never leave your device.** There are no backend servers, no analytics scraping your documents, and no uploads. Everything is processed directly in your device's memory.

## 🛠️ Tech Stack

This project proves you don't need a massive stack to build a powerful app.
- **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS (via CDN)
- **PDF Rendering:** [PDF.js](https://mozilla.github.io/pdf.js/)
- **Canvas/Editing Layer:** [Fabric.js](http://fabricjs.com/)
- **Native PDF Manipulation (Merge/Split):** [PDF-lib](https://pdf-lib.js.org/)

## 🚀 How to Use

Folio is already hosted and live! You can start using it right now without downloading any code.

**🔗 Try it live:** [Folio — PDF Suite](https://waseemsaleem.github.io/Folio-PDF-Suite/) *(Note: Update this link to your actual GitHub Pages URL)*

You have three ways to use it:
1. **On the Web:** Just open the link above in any modern browser on your desktop or phone to use it instantly.
2. **Install as an App (Android & Desktop):** Open the website and click the "⬇️ Install" button on the home screen to download it as a native, offline PWA.
3. **Install on iPhone (iOS):** Open the link in Safari, tap the **Share** button at the bottom of the screen, and select **"Add to Home Screen"**. This saves it as an app shortcut that runs in full screen!

*Want to host or modify it yourself?*
Since there is no build step, you can simply clone this repository and open `index.html` directly in your web browser, or host it on your own server.

## 👨‍💻 Created By

Designed, vibe-coded, and maintained by **[Waseem Saleem](https://waseemsaleem.com)** (with a little help from AI). 

If this tool makes your daily life a little easier, feel free to star the repo! ⭐️
