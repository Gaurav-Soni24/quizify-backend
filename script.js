// index.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initializeFirebase, uploadProcessData, downloadProcessData } = require('./firebase');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key'; // Use environment variables in production

// Initialize Firebase
const firebaseApp = initializeFirebase();
if (!firebaseApp) {
  console.error('Failed to initialize Firebase. Exiting...');
  process.exit(1);
}

// Test Route
app.get('/', (req, res) => {
  res.send('Firebase Auth with Express Backend');
});

// Register Route
app.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  
  // Basic validation
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Please provide all required fields.' });
  }

  const userId = email.replace(/[@.]/g, '_'); // Create a unique ID from email

  try {
    // Check if the email already exists
    const existingUser = await downloadProcessData('users', userId);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userData = { name, email, password: hashedPassword, role };
    await uploadProcessData('users', userId, userData);
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Basic validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password.' });
  }

  const userId = email.replace(/[@.]/g, '_'); // Create a unique ID from email

  try {
    const userData = await downloadProcessData('users', userId);
    if (!userData) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare hashed passwords
    const isMatch = await bcrypt.compare(password, userData.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: userId, role: userData.role },
      JWT_SECRET,
      { expiresIn: '1h' } // Token expires in 1 hour
    );

    res.status(200).json({ message: 'Login successful', token, userId });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Middleware to Verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token.' });
    req.user = user;
    next();
  });
};

// Protected Route Example
app.get('/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const userData = await downloadProcessData('users', userId);
    if (userData) {
      // Remove sensitive information before sending
      const { password, ...safeUserData } = userData;
      res.status(200).json({ message: 'Welcome to the dashboard', user: safeUserData });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error accessing dashboard:', error);
    res.status(500).json({ error: 'Failed to access dashboard' });
  }
});

// Get User Data Route (Protected)
app.get('/user/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;

  // Remove the check for matching userId to allow access to any user data
  // if (req.user.userId !== userId) {
  //   return res.status(403).json({ error: 'Access denied.' });
  // }

  try {
    const userData = await downloadProcessData('users', userId);
    if (userData) {
      // Remove sensitive information before sending
      const { password, ...safeUserData } = userData;
      res.status(200).json(safeUserData);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Logout Route (Client-side handles token removal)
// You can implement token blacklisting if necessary

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
