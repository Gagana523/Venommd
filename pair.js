const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    DisconnectReason
} = require('baileys');

// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '𝐀𝐔𝐑𝐀-𝐌𝐈𝐍𝐈';

const config = {
    AUTO_VIEW_STATUS: 'false',
    AUTO_LIKE_STATUS: 'false',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🔥', '😀', '👍', '😃', '😄', '😁', '😎', '🥳', '🌞', '🌈', '❤️'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/EekDsKzbgyfACsN1uO0Ehe?mode=gi_t',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/d6afvt.jpg',
    NEWSLETTER_JID: '120363427671810776@newsletter',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: process.env.OWNER_NUMBER || '94713047504',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7nfOX3bbUwsPm6Oe0w',
    BOT_NAME: '𝐀𝐔𝐑𝐀-𝐌𝐈𝐍𝐈 BOT',
    BOT_VERSION: '1.0.0V',
    OWNER_NAME: 'Gagana Anuhas',
    IMAGE_PATH: 'https://files.catbox.moe/d6afvt.jpg',
    BOT_FOOTER: '𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐀𝐔𝐑𝐀-𝐌𝐈𝐍𝐈(Anuhas)💥',
    BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/d6afvt.jpg' }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://gaganaanuhas321_db_user:qA7j6HCjZsud2ewF@cluster0.bhjppcs.mongodb.net/?appName=Cluster0';
const MONGO_DB = process.env.MONGO_DB || 'gaganaanuhas321_db_user'
let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
    try {
        if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
    } catch (e) { }
    mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await mongoClient.connect();
    mongoDB = mongoClient.db(MONGO_DB);

    sessionsCol = mongoDB.collection('sessions');
    numbersCol = mongoDB.collection('numbers');
    adminsCol = mongoDB.collection('admins');
    newsletterCol = mongoDB.collection('newsletter_list');
    configsCol = mongoDB.collection('configs');
    newsletterReactsCol = mongoDB.collection('newsletter_reacts');

    await sessionsCol.createIndex({ number: 1 }, { unique: true });
    await numbersCol.createIndex({ number: 1 }, { unique: true });
    await newsletterCol.createIndex({ jid: 1 }, { unique: true });
    await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
    await configsCol.createIndex({ number: 1 }, { unique: true });
    console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
        await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
        console.log(`Saved creds to Mongo for ${sanitized}`);
    } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        const doc = await sessionsCol.findOne({ number: sanitized });
        return doc || null;
    } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        await sessionsCol.deleteOne({ number: sanitized });
        console.log(`Removed session from Mongo for ${sanitized}`);
    } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
        console.log(`Added number ${sanitized} to Mongo numbers`);
    } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        await numbersCol.deleteOne({ number: sanitized });
        console.log(`Removed number ${sanitized} from Mongo numbers`);
    } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
    try {
        await initMongo();
        const docs = await numbersCol.find({}).toArray();
        return docs.map(d => d.number);
    } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
    try {
        await initMongo();
        const docs = await adminsCol.find({}).toArray();
        return docs.map(d => d.jid || d.number).filter(Boolean);
    } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
    try {
        await initMongo();
        const doc = { jid: jidOrNumber };
        await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
        console.log(`Added admin ${jidOrNumber}`);
    } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
    try {
        await initMongo();
        await adminsCol.deleteOne({ jid: jidOrNumber });
        console.log(`Removed admin ${jidOrNumber}`);
    } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
    try {
        await initMongo();
        const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
        await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
        console.log(`Added newsletter ${jid} -> emojis: ${doc.emojis.join(',')}`);
    } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
    try {
        await initMongo();
        await newsletterCol.deleteOne({ jid });
        console.log(`Removed newsletter ${jid}`);
    } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
    try {
        await initMongo();
        const docs = await newsletterCol.find({}).toArray();
        return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
    } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
    try {
        await initMongo();
        const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
        if (!mongoDB) await initMongo();
        const col = mongoDB.collection('newsletter_reactions_log');
        await col.insertOne(doc);
        console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
    } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
    } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
    try {
        await initMongo();
        const sanitized = number.replace(/[^0-9]/g, '');
        const doc = await configsCol.findOne({ number: sanitized });
        return doc ? doc.config : null;
    } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
    try {
        await initMongo();
        await newsletterReactsCol.updateOne({ jid }, { $set: { jid, emojis, addedAt: new Date() } }, { upsert: true });
        console.log(`Added react-config for ${jid} -> ${emojis.join(',')}`);
    } catch (e) { console.error('addNewsletterReactConfig', e); throw e; }
}

async function removeNewsletterReactConfig(jid) {
    try {
        await initMongo();
        await newsletterReactsCol.deleteOne({ jid });
        console.log(`Removed react-config for ${jid}`);
    } catch (e) { console.error('removeNewsletterReactConfig', e); throw e; }
}

async function listNewsletterReactsFromMongo() {
    try {
        await initMongo();
        const docs = await newsletterReactsCol.find({}).toArray();
        return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
    } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
    try {
        await initMongo();
        const doc = await newsletterReactsCol.findOne({ jid });
        return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
    } catch (e) { console.error('getReactConfigForJid', e); return null; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp() { return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();

const socketCreationTime = new Map();

const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
    const inviteCode = inviteCodeMatch[1];
    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) return { status: 'success', gid: response.gid };
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
            else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
            else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
    const admins = await loadAdminsFromMongo();
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
    const caption = formatMessage(botName, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}`, botName);
    for (const admin of admins) {
        try {
            const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
            if (String(image).startsWith('http')) {
                await socket.sendMessage(to, { image: { url: image }, caption });
            } else {
                try {
                    const buf = fs.readFileSync(image);
                    await socket.sendMessage(to, { image: buf, caption });
                } catch (e) {
                    await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
                }
            }
        } catch (err) {
            console.error('Failed to send connect message to admin', admin, err?.message || err);
        }
    }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
    try {
        const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        const activeCount = activeSockets.size;
        const botName = sessionConfig.botName || BOT_NAME_FANCY;
        const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
        const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
        const caption = formatMessage(`👑 OWNER CONNECT — ${botName}`, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}\n\n🔢 Active sessions: ${activeCount}`, botName);
        if (String(image).startsWith('http')) {
            await socket.sendMessage(ownerJid, { image: { url: image }, caption });
        } else {
            try {
                const buf = fs.readFileSync(image);
                await socket.sendMessage(ownerJid, { image: buf, caption });
            } catch (e) {
                await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
            }
        }
    } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
    catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
    const rrPointers = new Map();

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;
        const jid = message.key.remoteJid;

        try {
            const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
            const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
            const reactMap = new Map();
            for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

            const followedJids = followedDocs.map(d => d.jid);
            if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

            let emojis = reactMap.get(jid) || null;
            if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
                emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
            }
            if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

            let idx = rrPointers.get(jid) || 0;
            const emoji = emojis[idx % emojis.length];
            rrPointers.set(jid, (idx + 1) % emojis.length);

            const messageId = message.newsletterServerId || message.key.id;
            if (!messageId) return;

            let retries = 3;
            while (retries-- > 0) {
                try {
                    if (typeof socket.newsletterReactMessage === 'function') {
                        await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
                    } else {
                        await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
                    }
                    console.log(`Reacted to ${jid} ${messageId} with ${emoji}`);
                    await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
                    break;
                } catch (err) {
                    console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
                    await delay(1200);
                }
            }

        } catch (error) {
            console.error('Newsletter reaction handler error:', error?.message || error);
        }
    });
}


// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        try {
            if (config.AUTO_RECORDING === 'true') await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try { await socket.readMessages([message.key]); break; }
                    catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries === 0) throw error; }
                }
            }
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
                        break;
                    } catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries === 0) throw error; }
                }
            }

        } catch (error) { console.error('Status handler error:', error); }
    });
}


async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        const message = formatMessage('🗑️ MESSAGE DELETED', `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`, BOT_NAME_FANCY);
        try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
        catch (error) { console.error('Failed to send deletion notification:', error); }
    });
}


async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}


// ---------------- command handlers ----------------

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

        const from = msg.key.remoteJid;
        const sender = from;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = (nowsender || '').split('@')[0];
        const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
        const isOwner = senderNumber === config.OWNER_NUMBER.replace(/[^0-9]/g, '');

        const body = (type === 'conversation') ? msg.message.conversation
            : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
                : (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption
                    : (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption
                        : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
                            : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
                                : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';

        if (!body || typeof body !== 'string') return;

        const prefix = config.PREFIX;
        const isCmd = body && body.startsWith && body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
        const args = body.trim().split(/ +/).slice(1);

        // helper: download quoted media into buffer
        async function downloadQuotedMedia(quoted) {
            if (!quoted) return null;
            const qTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
            const qType = qTypes.find(t => quoted[t]);
            if (!qType) return null;
            const messageType = qType.replace(/Message$/i, '').toLowerCase();
            const stream = await downloadContentFromMessage(quoted[qType], messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return {
                buffer,
                mime: quoted[qType].mimetype || '',
                caption: quoted[qType].caption || quoted[qType].fileName || '',
                ptt: quoted[qType].ptt || false,
                fileName: quoted[qType].fileName || ''
            };
        }

        if (!command) return;

        try {
            switch (command) {
                // --- existing commands (deletemenumber, unfollow, newslist, admin commands etc.) ---
                // ... (keep existing other case handlers unchanged) ...
                case 'ts': {
                    const axios = require('axios');

                    const q = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    let query = q.replace(/^[.\/!]ts\s*/i, '').trim();

                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: '[❗] TikTok එකේ මොකද්ද බලන්න ඕනෙ කියපං! 🔍'
                        }, { quoted: msg });
                    }

                    // 🔹 Load bot name dynamically
                    const sanitized = (number || '').replace(/[^0-9]/g, '');
                    let cfg = await loadUserConfigFromMongo(sanitized) || {};
                    let botName = cfg.botName || 'VENOM-MD MINI BOT';

                    // 🔹 Fake contact for quoting
                    const shonux = {
                        key: {
                            remoteJid: "status@broadcast",
                            participant: "0@s.whatsapp.net",
                            fromMe: false,
                            id: "META_AI_FAKE_ID_TS"
                        },
                        message: {
                            contactMessage: {
                                displayName: botName,
                                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                            }
                        }
                    };

                    try {
                        await socket.sendMessage(sender, { text: `🔎 Searching TikTok for: ${query}...` }, { quoted: shonux });

                        const searchParams = new URLSearchParams({ keywords: query, count: '10', cursor: '0', HD: '1' });
                        const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
                            headers: { 'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8", 'Cookie': "current_language=en", 'User-Agent': "Mozilla/5.0" }
                        });

                        const videos = response.data?.data?.videos;
                        if (!videos || videos.length === 0) {
                            return await socket.sendMessage(sender, { text: '⚠️ No videos found.' }, { quoted: shonux });
                        }

                        // Limit number of videos to send
                        const limit = 3;
                        const results = videos.slice(0, limit);

                        // 🔹 Send videos one by one
                        for (let i = 0; i < results.length; i++) {
                            const v = results[i];
                            const videoUrl = v.play || v.download || null;
                            if (!videoUrl) continue;

                            await socket.sendMessage(sender, { text: `⏳ Downloading: ${v.title || 'No Title'}` }, { quoted: shonux });

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                caption: `🎵 ${botName} TikTok Downloader\n\nTitle: ${v.title || 'No Title'}\nAuthor: ${v.author?.nickname || 'Unknown'}`
                            }, { quoted: shonux });
                        }

                    } catch (err) {
                        console.error('TikTok Search Error:', err);
                        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: shonux });
                    }

                    break;
                }


                case 'getdp': {
                    try {
                        const sanitized = (number || '').replace(/[^0-9]/g, '');
                        const cfg = await loadUserConfigFromMongo(sanitized) || {};
                        const botName = cfg.botName || BOT_NAME_FANCY;
                        const logo = cfg.logo || config.RCD_IMAGE_PATH;

                        const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

                        let q = msg.message?.conversation?.split(" ")[1] ||
                            msg.message?.extendedTextMessage?.text?.split(" ")[1];

                        if (!q) return await socket.sendMessage(sender, { text: "❌ Please provide a number.\n\nUsage: .getdp <number>" });

                        // 🔹 Format number into JID
                        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

                        // 🔹 Try to get profile picture
                        let ppUrl;
                        try {
                            ppUrl = await socket.profilePictureUrl(jid, "image");
                        } catch {
                            ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default dp
                        }

                        // 🔹 BotName meta mention
                        const metaQuote = {
                            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
                            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
                        };

                        // 🔹 Send DP with botName meta mention
                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: `🖼 *Profile Picture of* +${q}\nFetched by: ${botName}`,
                            footer: `📌 ${botName} GETDP`,
                            buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
                            headerType: 4
                        }, { quoted: metaQuote }); // <-- botName meta mention

                    } catch (e) {
                        console.log("❌ getdp error:", e);
                        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
                    }
                    break;
                }

                case 'ai':
                case 'chat':
                case 'gpt': {
                    try {
                        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
                        const q = text.split(" ").slice(1).join(" ").trim();

                        if (!q) {
                            await socket.sendMessage(sender, {
                                text: '*🚫 Please provide a message for AI.*',
                                buttons: [
                                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                                ]
                            });
                            return;
                        }

                        // Session number
                        const sanitized = (number || '').replace(/[^0-9]/g, '');
                        // Load bot name from DB or default
                        let cfg = await loadUserConfigFromMongo(sanitized) || {};
                        let botName = cfg.botName || '𝐀𝐔𝐑𝐀-𝐌𝐈𝐍𝐈 BOT AI';

                        // Meta AI mention for quote
                        const metaQuote = {
                            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: `META_AI_${Date.now()}` },
                            message: {
                                contactMessage: {
                                    displayName: botName,
                                    vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
                                }
                            }
                        };

                        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
                        await socket.sendMessage(sender, { text: '*⏳ AI thinking...*', quoted: metaQuote });

                        const prompt =
