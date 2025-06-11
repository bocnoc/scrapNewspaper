const server = require('../server');
const { parse } = require('url');

// Export hàm handler cho Vercel
export default async function handler(req, res) {
  // Chuyển request đến Express app
  return new Promise((resolve, reject) => {
    const { pathname } = parse(req.url, true);
    
    // Xử lý CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-V'
    );

    // Xử lý preflight request
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return resolve();
    }

    // Chuyển request đến Express app
    server.app(req, res, (err) => {
      if (err) {
        console.error('Error handling request:', err);
        res.status(500).json({ error: 'Internal Server Error' });
        return resolve();
      }
      resolve();
    });
  });
}
