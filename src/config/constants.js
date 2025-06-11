const BROWSER_OPTIONS = {
    headless: 'new',
    executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ignoreHTTPSErrors: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled' // Thêm flag này để tránh bị phát hiện
    ],
    defaultViewport: { 
        width: 1920, 
        height: 1080,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
    },
    timeout: 60000, // Tăng timeout lên 60 giây
    ignoreDefaultArgs: ['--enable-automation'],
    dumpio: false // Tắt log của trình duyệt để đỡ rối
};

const BASE_URL = 'https://vnexpress.net';

const CATEGORY_MAP = {
    'thoi-su': `${BASE_URL}/thoi-su`,
    'the-gioi': `${BASE_URL}/the-gioi`,
    'kinh-doanh': `${BASE_URL}/kinh-doanh`,
    'giai-tri': `${BASE_URL}/giai-tri`,
    'the-thao': `${BASE_URL}/the-thao`,
    'phap-luat': `${BASE_URL}/phap-luat`,
    'giao-duc': `${BASE_URL}/giao-duc`,
    'suc-khoe': `${BASE_URL}/suc-khoe`,
    'doi-song': `${BASE_URL}/doi-song`,
    'du-lich': `${BASE_URL}/du-lich`,
    'khoa-hoc': `${BASE_URL}/khoa-hoc`,
    'so-hoa': `${BASE_URL}/so-hoa`,
    'xe': `${BASE_URL}/xe`,
    'tuan-viet-nam': `${BASE_URL}/tuan-viet-nam`,
    'bat-dong-san': `${BASE_URL}/bat-dong-san`,
    'ban-doc': `${BASE_URL}/ban-doc`
};

module.exports = {
    BROWSER_OPTIONS,
    CATEGORY_MAP
};
