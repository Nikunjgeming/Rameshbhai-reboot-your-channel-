const fetch = require('node-fetch');

// Environment variables se API key lo
const API_KEY = process.env.SASTAOTP_API_KEY || 'stp_8c391608fc688dbb1028ce30bfc9a9e86ccd8d6983a769f6';
const API_URL = 'https://sastaotp.com/stubs/handler_api.php';

// Simple in-memory storage (for demo - production mein external DB use karo)
// Netlify ke liye: use FaunaDB, Supabase, or Upstash
let users = [];
let deposits = [];
let orders = [];
let sessions = {};

// Save data to Netlify Blob storage (optional)
const BLOB_STORE = 'otp-data';

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const action = event.queryStringParameters?.action || 
                   (event.body ? JSON.parse(event.body || '{}').action : null);

    console.log(`Action: ${action}, Method: ${event.httpMethod}`);

    // GET requests
    if (event.httpMethod === 'GET') {
        switch(action) {
            case 'getBalance':
                return await getBalance(headers);
            case 'getServices':
                return await getServices(headers);
            case 'getAllServices':
                return await getAllServices(headers);
            case 'checkOTP':
                const id = params.get('id');
                return await checkOTP(id, headers);
            case 'getAllDeposits':
                return await getAllDeposits(headers);
            case 'getAllUsers':
                return await getAllUsers(headers);
            case 'getAllOrders':
                return await getAllOrders(headers);
            case 'getStats':
                return await getStats(headers);
            case 'approveDeposit':
                const depositId = params.get('id');
                return await approveDeposit(depositId, headers);
            case 'rejectDeposit':
                const rejectId = params.get('id');
                return await rejectDeposit(rejectId, headers);
            default:
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invalid action' }) };
        }
    }

    // POST requests
    if (event.httpMethod === 'POST') {
        const body = JSON.parse(event.body || '{}');
        
        switch(action) {
            case 'register':
                return await register(body, headers);
            case 'login':
                return await login(body, headers);
            case 'buyNumber':
                return await buyNumber(body, headers);
            case 'requestDeposit':
                return await requestDeposit(body, headers);
            case 'savePromo':
                return await savePromo(body, headers);
            case 'addAdmin':
                return await addAdmin(body, headers);
            default:
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invalid action' }) };
        }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

// ============= API FUNCTIONS =============

async function register(body, headers) {
    const { name, email, password } = body;
    
    // Check if user exists
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Email already registered' }) };
    }
    
    // Create new user
    const newUser = {
        id: users.length + 1,
        name,
        email,
        password: hashPassword(password), // Simple hash
        balance: 0,
        is_admin: false,
        created_at: new Date().toISOString()
    };
    
    users.push(newUser);
    
    // For demo admin (first user can be admin)
    if (users.length === 1 && email === 'admin@otp.com') {
        newUser.is_admin = true;
    }
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: { id: newUser.id, email: newUser.email, name: newUser.name } }) };
}

async function login(body, headers) {
    const { email, password } = body;
    
    const user = users.find(u => u.email === email);
    if (!user || user.password !== hashPassword(password)) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Invalid credentials' }) };
    }
    
    // Create session
    const sessionId = generateSessionId();
    sessions[sessionId] = { userId: user.id, expires: Date.now() + 86400000 };
    
    const { password: _, ...userWithoutPassword } = user;
    
    return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
            success: true, 
            user: userWithoutPassword,
            sessionId: sessionId
        }) 
    };
}

async function getBalance(headers) {
    const result = await apiRequest({ action: 'getBalance' });
    const balance = result.balance || 0;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, balance: balance }) };
}

async function getServices(headers) {
    const result = await apiRequest({ action: 'getServicesList' });
    const services = result.services || {};
    
    const formatted = Object.entries(services).map(([code, info]) => ({
        code: code,
        name: info.name,
        price: info.price,
        available: info.available
    }));
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, services: formatted }) };
}

async function getAllServices(headers) {
    // Mock services for demo
    const services = [
        { code: 'tg', name: 'Telegram', price: 18.50, available: 999, icon: 'fab fa-telegram', desc: 'Telegram OTP verification' },
        { code: 'wa', name: 'WhatsApp', price: 25.00, available: 850, icon: 'fab fa-whatsapp', desc: 'WhatsApp Business & Personal' },
        { code: 'gp', name: 'Google', price: 15.00, available: 2000, icon: 'fab fa-google', desc: 'Google account, Gmail, YouTube' },
        { code: 'fb', name: 'Facebook', price: 20.00, available: 750, icon: 'fab fa-facebook', desc: 'Facebook account verification' },
        { code: 'ig', name: 'Instagram', price: 22.00, available: 680, icon: 'fab fa-instagram', desc: 'Instagram account verification' }
    ];
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, services: services }) };
}

async function buyNumber(body, headers) {
    const { service, userId, country = '91' } = body;
    
    // Check balance
    const user = users.find(u => u.id === userId);
    const services = await getServicesList();
    const price = services[service]?.price || 18.50;
    
    if (!user || user.balance < price) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Insufficient balance' }) };
    }
    
    // Buy number from API
    const result = await apiRequest({
        action: 'getNumber',
        service: service,
        country: country
    });
    
    if (result.status === 'OK') {
        // Deduct balance
        user.balance -= price;
        
        // Save order
        const order = {
            id: orders.length + 1,
            user_id: userId,
            order_id: result.activation_id,
            phone_number: result.number,
            service: service,
            amount: price,
            status: 'pending',
            created_at: new Date().toISOString()
        };
        orders.push(order);
        
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ 
                success: true, 
                activation_id: result.activation_id,
                number: result.number,
                price: price
            }) 
        };
    }
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: result.status || 'Failed to buy number' }) };
}

async function checkOTP(activationId, headers) {
    const result = await apiRequest({
        action: 'getStatus',
        id: activationId
    });
    
    if (result.sms && result.sms.code) {
        // Update order
        const order = orders.find(o => o.order_id === activationId);
        if (order) {
            order.otp_code = result.sms.code;
            order.status = 'completed';
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, code: result.sms.code }) };
    }
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: false }) };
}

async function requestDeposit(body, headers) {
    const { userId, amount, transactionId } = body;
    
    const deposit = {
        id: deposits.length + 1,
        user_id: userId,
        amount: parseFloat(amount),
        transaction_id: transactionId,
        status: 'pending',
        created_at: new Date().toISOString()
    };
    
    deposits.push(deposit);
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function getAllDeposits(headers) {
    const depositsWithUser = deposits.map(d => {
        const user = users.find(u => u.id === d.user_id);
        return { ...d, user_email: user?.email || 'Unknown' };
    });
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, deposits: depositsWithUser }) };
}

async function getAllUsers(headers) {
    const usersWithoutPassword = users.map(({ password, ...user }) => user);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, users: usersWithoutPassword }) };
}

async function getAllOrders(headers) {
    const ordersWithUser = orders.map(o => {
        const user = users.find(u => u.id === o.user_id);
        return { ...o, user_email: user?.email || 'Unknown' };
    });
    
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, orders: ordersWithUser }) };
}

async function getStats(headers) {
    const totalDeposits = deposits.filter(d => d.status === 'approved').reduce((sum, d) => sum + d.amount, 0);
    const todayDeposits = deposits.filter(d => {
        const today = new Date().toDateString();
        const depositDate = new Date(d.created_at).toDateString();
        return d.status === 'approved' && depositDate === today;
    }).reduce((sum, d) => sum + d.amount, 0);
    
    return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
            success: true, 
            total_deposits: totalDeposits, 
            today_collection: todayDeposits 
        }) 
    };
}

async function approveDeposit(depositId, headers) {
    const deposit = deposits.find(d => d.id == depositId);
    if (deposit && deposit.status === 'pending') {
        deposit.status = 'approved';
        const user = users.find(u => u.id === deposit.user_id);
        if (user) {
            user.balance = (user.balance || 0) + deposit.amount;
        }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function rejectDeposit(depositId, headers) {
    const deposit = deposits.find(d => d.id == depositId);
    if (deposit) {
        deposit.status = 'rejected';
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function savePromo(body, headers) {
    // Promo code logic
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

async function addAdmin(body, headers) {
    const { name, email, password } = body;
    const newAdmin = {
        id: users.length + 1,
        name,
        email,
        password: hashPassword(password),
        balance: 0,
        is_admin: true,
        created_at: new Date().toISOString()
    };
    users.push(newAdmin);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

// ============= HELPER FUNCTIONS =============

async function apiRequest(params) {
    params.api_key = API_KEY;
    params.format = 'json';
    
    const url = API_URL + '?' + new URLSearchParams(params);
    
    try {
        const response = await fetch(url);
        const text = await response.text();
        
        if (text.startsWith('{')) {
            return JSON.parse(text);
        }
        return { status: 'OK', raw: text };
    } catch (error) {
        console.error('API Error:', error);
        return { status: 'ERROR', error: error.message };
    }
}

async function getServicesList() {
    const result = await apiRequest({ action: 'getServicesList' });
    return result.services || {};
}

function hashPassword(password) {
    // Simple hash for demo - production mein bcrypt use karo
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        hash = ((hash << 5) - hash) + password.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString();
}

function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}