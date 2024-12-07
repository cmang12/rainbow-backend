const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const { Timestamp, collection, getDocs, query, where, getFirestore } = require("firebase/firestore");
const Sentiment = require('sentiment');
const moment = require('moment');  

// Load environment variables
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json'); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Function to fetch sentiment score for the user
const getSentimentScore = async (userId) => {
  const currentDate = moment(); // Current date
  const sevenDaysAgo = moment().subtract(7, 'days'); // Date 7 days ago

  const journalRef = db.collection('entries');

  const snapshot = await journalRef
    .where('author.id', '==', userId)  // Filter by user ID
    .where("selectedDate", ">=", sevenDaysAgo.toISOString())
    .get();

  if (snapshot.empty) {
    return { sentimentScore: 0, sentimentComparative: 0, positiveWords: [], negativeWords: [] };
  }

  // Collect all entries from the user's entries
  let allText = "";
  snapshot.forEach((doc) => {
    allText += `${doc.data().postText} `;
  });

  // Perform sentiment analysis
  const sentiment = new Sentiment();
  const result = sentiment.analyze(allText);

  return {
    sentimentScore: result.score,
    sentimentComparative: result.comparative,
    positiveWords: result.positive,
    negativeWords: result.negative,
  };
};

// Route to handle AI response
app.post("/api/chat", async (req, res) => {
  const { userInput, userId} = req.body;

  if (!userInput || !userId) {
    return res.status(400).json({ error: "User input and user ID are required" });
  }

  try {
    // Fetch the sentiment score for the user
    const sentimentData = await getSentimentScore(userId);
    const sentimentScore = sentimentData.sentimentScore;
    const sentimentMessage = sentimentScore > 0
      ? "It seems you're in a positive mood this week! Let's keep that energy going."
      : sentimentScore < 0
      ? "It seems like you might be feeling down. I'm here to help and listen."
      : "It seems like you're feeling neutral this week. Let's talk about what's on your mind.";

    // Set the AI system message based on sentiment
    const systemMessage = `You are a mental health assistant focused on providing empathetic, supportive, and helpful advice. 
    Your goal is to help users feel heard, validated, and gently guided without giving medical advice. 
    Always respond with care and understanding. ${sentimentMessage}`;

    // Create the AI chat request
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userInput },
      ],
    });

    const aiResponse = completion.choices[0].message.content.trim();
    res.json({ aiResponse });
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    res.status(500).json({ error: "Failed to fetch AI response" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
