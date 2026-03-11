const mongoose = require('mongoose');

// Stored after WebAuthn registration for use in authentication
const webAuthnCredentialSchema = new mongoose.Schema({
  id: { type: String, required: true },           // base64url credential ID
  publicKey: { type: Buffer, required: true },    // COSE public key bytes
  counter: { type: Number, required: true, default: 0 },
  transports: [{ type: String }],
  deviceType: { type: String },
  backedUp: { type: Boolean },
  webauthnUserID: { type: String, required: true },
}, { _id: false });

const studentSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  studentId: { type: String, required: true, unique: true },
  webAuthnCredentials: [webAuthnCredentialSchema],
  photoHash: { type: String },
});

module.exports = mongoose.model('Student', studentSchema);
