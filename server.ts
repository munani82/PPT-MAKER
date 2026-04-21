import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Image Proxy to solve CORS issues
  app.get("/api/proxy-image", async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl) return res.status(400).send("No URL provided");

    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        headers: {
          "Referer": "https://www.naver.com", // Some hosts check referer
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });

      const contentType = response.headers["content-type"] as string || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.send(response.data);
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).send("Failed to fetch image");
    }
  });

  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Do not handle '*' here for Vercel, as vercel.json handles routing
    if (!process.env.VERCEL) {
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  if (process.env.VERCEL !== "1") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

// For Vercel Serverless Functions
export default startServer().then(() => app);
const appInstance = app; 
export { appInstance as app };
