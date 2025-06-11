const serverless = require('serverless-http');
const app = require('./server');

// Sửa đổi hàm getBrowser để tương thích với Lambda
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

// Ghi đè hàm getBrowser gốc
const getBrowser = async () => {
  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
};

// Gán lại hàm getBrowser mới
Object.assign(global, { getBrowser });

// Xuất handler cho Lambda
exports.handler = serverless(app);
