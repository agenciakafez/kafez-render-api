const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Kafez Render API"
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
