const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_CODE = process.env.AUTH_CODE || '12345';

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware for write operations
const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const authCode = authHeader ? authHeader.replace('Bearer ', '') : '';
  
  if (authCode !== AUTH_CODE) {
    return res.status(403).json({ error: 'Unauthorized: Invalid or missing auth code' });
  }
  next();
};

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Get all images
app.get('/api/images', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read images' });
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const images = files.filter(f => 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
    ).map(f => ({
      filename: f,
      url: `${baseUrl}/uploads/${f}`
    }));
    
    res.json(images);
  });
});

// Get random image
app.get('/api/random-image', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read images' });
    
    const images = files.filter(f => 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
    );
    
    if (images.length === 0) {
      return res.status(404).json({ error: 'No images found' });
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const randomImage = images[Math.floor(Math.random() * images.length)];
    res.json({ url: `${baseUrl}/uploads/${randomImage}` });
  });
});

// Upload image
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    success: true,
    filename: req.file.filename,
    url: `${baseUrl}/uploads/${req.file.filename}`
  });
});

// Delete image
app.delete('/api/delete/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  // Prevent directory traversal
  if (!filePath.startsWith(uploadsDir)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete image' });
    res.json({ success: true });
  });
});

// Serve uploaded images
app.use('/uploads', express.static(uploadsDir));

// Serve admin panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Image service running on port ${PORT}`);
});
