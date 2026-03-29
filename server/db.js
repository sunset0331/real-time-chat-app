const mongoose = require('mongoose');

const connectDb = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: true,
  });
};

module.exports = {
  connectDb,
};
