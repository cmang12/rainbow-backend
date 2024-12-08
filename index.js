const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const Sentiment = require("sentiment");
const moment = require("moment");

// Load environment variables
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

const admin = require("firebase-admin");
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Fetch user chat history from Firestore
const getChatHistory = async (userId) => {
  const chatRef = db.collection("chatSessions").doc(userId);
  const chatDoc = await chatRef.get();

  if (!chatDoc.exists) {
    return [];
  }

  return chatDoc.data().history || [];
};

// Save user chat history to Firestore
const saveChatHistory = async (userId, history) => {
  const chatRef = db.collection("chatSessions").doc(userId);
  await chatRef.set({ history });
};

// Route to handle AI response
app.post("/api/chat", async (req, res) => {
  const { userInput, userId, reset } = req.body;

  if (!userInput || !userId) {
    return res.status(400).json({ error: "User input and user ID are required" });
  }

  try {
    let chatHistory = [];

    // Reset conversation if requested
    if (reset) {
      await saveChatHistory(userId, []);
    } else {
      chatHistory = await getChatHistory(userId);
    }

    // Fetch sentiment data and construct system message
    const sentimentData = await getSentimentScore(userId);
    const sentimentScore = sentimentData.sentimentScore;
    const sentimentMessage =
      sentimentScore > 0
        ? "It seems you're in a positive mood this week! Let's keep that energy going."
        : sentimentScore < 0
        ? "It seems like you might be feeling down. I'm here to help and listen."
        : "It seems like you're feeling neutral this week. Let's talk about what's on your mind.";

    const systemMessage = `You are a mental health assistant focused on providing empathetic, supportive, and helpful advice. 
    Your goal is to help users feel heard, validated, and gently guided without giving medical advice. 
    Always respond with care and understanding. ${sentimentMessage}`;

    // Add system message at the beginning of the conversation if the history is empty
    if (chatHistory.length === 0) {
      chatHistory.push({ role: "system", content: systemMessage });
    }

    // Add the user's input to the conversation
    chatHistory.push({ role: "user", content: userInput });

    // Call OpenAI API with the full conversation history
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: chatHistory,
    });

    const aiResponse = completion.choices[0].message.content.trim();

    // Add AI response to the conversation history
    chatHistory.push({ role: "assistant", content: aiResponse });

    // Save updated history to Firestore
    await saveChatHistory(userId, chatHistory);

    res.json({ aiResponse });
  } catch (error) {
    console.error("Error calling OpenAI API or interacting with Firestore:", error);
    res.status(500).json({ error: "Failed to fetch AI response or save chat history" });
  }
});

app.post("/api/sentiment", async (req, res) => {
    const { userId } = req.body;
  
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
  
    try {
      const sevenDaysAgo = moment().subtract(7, "days");
  
      const journalRef = db.collection("entries");
      const snapshot = await journalRef
        .where("author.id", "==", userId)
        .where("selectedDate", ">=", sevenDaysAgo.toISOString())
        .get();
  
      if (snapshot.empty) {
        return res.json({ stats: { positive: 0, negative: 0, neutral: 0 } });
      }
  
      let allText = "";
      snapshot.forEach((doc) => {
        allText += `${doc.data().postText} `;
      });
  
      const sentiment = new Sentiment();
      const result = sentiment.analyze(allText);
  
      const stats = {
        positive: result.positive.length,
        negative: result.negative.length,
        neutral: result.tokens.length - result.positive.length - result.negative.length,
      };
  
      res.json({ stats });
    } catch (error) {
      console.error("Error performing sentiment analysis:", error);
      res.status(500).json({ error: "Failed to analyze sentiment" });
    }
  });

// Sentiment analysis function (same as before)
const getSentimentScore = async (userId) => {
  const sevenDaysAgo = moment().subtract(7, "days");

  const journalRef = db.collection("entries");

  const snapshot = await journalRef
    .where("author.id", "==", userId)
    .where("selectedDate", ">=", sevenDaysAgo.toISOString())
    .get();

  if (snapshot.empty) {
    return { sentimentScore: 0, sentimentComparative: 0, positiveWords: [], negativeWords: [] };
  }

  let allText = "";
  snapshot.forEach((doc) => {
    allText += `${doc.data().postText} `;
  });

  const sentiment = new Sentiment();
  const result = sentiment.analyze(allText);

  return {
    sentimentScore: result.score,
    sentimentComparative: result.comparative,
    positiveWords: result.positive,
    negativeWords: result.negative,
  };
};

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
