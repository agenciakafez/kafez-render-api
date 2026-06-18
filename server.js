const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 8080;
const OUTPUT_DIR = path.join(__dirname, "outputs");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Kafez Render API"
  });
});

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const file = fs.createWriteStream(filepath);

    client.get(url, (response) => {
      response.pipe(file);

      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", reject);
  });
}

app.post("/render", async (req, res) => {
  try {
    const { videos } = req.body;

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({
        error: "Envie um array de vídeos em videos"
      });
    }

    const jobId = Date.now().toString();
    const jobDir = path.join(OUTPUT_DIR, jobId);

    fs.mkdirSync(jobDir);

    const downloadedVideos = [];

    for (let i = 0; i < videos.length; i++) {
      const videoPath = path.join(jobDir, `video_${i}.mp4`);
      await downloadFile(videos[i], videoPath);
      downloadedVideos.push(videoPath);
    }

    const listPath = path.join(jobDir, "list.txt");

    const listContent = downloadedVideos
      .map((file) => `file '${file}'`)
      .join("\n");

    fs.writeFileSync(listPath, listContent);

    const outputPath = path.join(jobDir, "output.mp4");

    const command = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;

    exec(command, (error) => {
      if (error) {
        return res.status(500).json({
          error: "Erro ao renderizar vídeo",
          details: error.message
        });
      }

      res.json({
        status: "done",
        message: "Vídeo renderizado com sucesso",
        jobId,
        output: `/outputs/${jobId}/output.mp4`
      });
    });
  } catch (error) {
    res.status(500).json({
      error: "Erro interno",
      details: error.message
    });
  }
});

app.use("/outputs", express.static(OUTPUT_DIR));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
