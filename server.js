const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3230;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch('http://localhost:8000/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...req.body,
        max_tokens: 8192,
        stop_tokens: [0, 261, 24281],
        temperature: 1.0,
        top_k: 1,
        top_p: 0.3,
        pad_zero: true,
        alpha_presence: 0.5,
        alpha_frequency: 0.5,
        alpha_decay: 0.996,
        chunk_size: 8,
        stream: true,
        enable_think: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 设置响应头以支持流式传输
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 使用 async iterator 处理流
    for await (const chunk of response.body) {
      res.write(chunk);
    }
    
    res.end();
  } catch (error) {
    console.error('Error proxying request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});