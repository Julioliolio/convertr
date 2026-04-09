const path = require('path');
const os = require('os');

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  TEMP_DIR: process.env.TEMP_DIR || path.join(os.tmpdir(), 'converter'),

  // File limits
  MAX_FILE_SIZE: 500 * 1024 * 1024, // 500 MB

  // Cleanup timeouts (ms)
  UPLOAD_CLEANUP_MS:     30 * 60 * 1000,  // 30 minutes — unused uploads
  CONVERSION_CLEANUP_MS: 10 * 60 * 1000,  // 10 minutes — completed outputs
  ERROR_CLEANUP_MS:      5 * 1000,         //  5 seconds — failed jobs
  SSE_TIMEOUT_MS:        30 * 60 * 1000,   // 30 minutes — max SSE connection

  // Estimation
  ESTIMATE_TIMEOUT_MS: 15_000,             // 15 seconds per sample
  ESTIMATE_SAMPLE_DUR: 0.5,               //  0.5 seconds per sample

  // Stderr buffer cap (bytes kept for error messages)
  STDERR_BUFFER: 2048,

  // Supported formats
  VALID_INPUT:  /\.(mp4|mov|avi|mkv|webm|flv|wmv|gif|m4v|ts|mts|3gp|ogv)$/i,
  VALID_OUTPUT: ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv'],
};
