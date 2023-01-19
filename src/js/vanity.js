/* eslint-env worker */
import secp256k1 from 'secp256k1';
import keccak from 'keccak';
import randomBytes from 'randombytes';

import { v4 } from 'uuid';
import CryptoJS from 'crypto-js';

const step = 500;

var wallets = '';
var addresses = '';
var numAddresses = 10; // change this
var password = 'password'; // change this

/**
 * Transform a private key into an address
 */
const privateToAddress = (privateKey) => {
    const pub = secp256k1.publicKeyCreate(privateKey, false).slice(1);
    return keccak('keccak256').update(pub).digest().slice(-20).toString('hex');
};

/**
 * Create a wallet from a random private key
 * @returns {{address: string, privKey: string}}
 */
const getRandomWallet = () => {
    const randbytes = randomBytes(32);
    return {
        address: privateToAddress(randbytes).toString('hex'),
        privKey: randbytes.toString('hex'),
    };
};

/**
 * Check if a wallet respects the input constraints
 * @param address
 * @param input
 * @param isChecksum
 * @param isSuffix
 * @returns {boolean}
 */
const isValidVanityAddress = (address, input, isChecksum, isSuffix) => {
    const subStr = isSuffix ? address.substr(40 - input.length) : address.substr(0, input.length);

    if (!isChecksum) {
        return input === subStr;
    }
    if (input.toLowerCase() !== subStr) {
        return false;
    }

    return isValidChecksum(address, input, isSuffix);
};

const isValidChecksum = (address, input, isSuffix) => {
    const hash = keccak('keccak256').update(address).digest().toString('hex');
    const shift = isSuffix ? 40 - input.length : 0;

    for (let i = 0; i < input.length; i++) {
        const j = i + shift;
        if (input[i] !== (parseInt(hash[j], 16) >= 8 ? address[j].toUpperCase() : address[j])) {
            return false;
        }
    }
    return true;
};

const toChecksumAddress = (address) => {
    const hash = keccak('keccak256').update(address).digest().toString('hex');
    let ret = '';
    for (let i = 0; i < address.length; i++) {
        ret += parseInt(hash[i], 16) >= 8 ? address[i].toUpperCase() : address[i];
    }
    return ret;
};

/**
 * Generate a lot of wallets until one satisfies the input constraints
 * @param input - String chosen by the user
 * @param isChecksum - Is the input case-sensitive
 * @param isSuffix - Is it a suffix, or a prefix
 * @param cb - Callback called after x attempts, or when an address if found
 * @returns
 */
const getVanityWallet = (input, isChecksum, isSuffix, cb) => {
    input = isChecksum ? input : input.toLowerCase();
    let wallet = getRandomWallet();
    let attempts = 1;
    let completions = 0;
    while (completions < numAddresses) {
        wallet = getRandomWallet();
        while (!isValidVanityAddress(wallet.address, input, isChecksum, isSuffix)) {
            if (attempts >= step) {
                cb({ attempts });
                attempts = 0;
            }
            wallet = getRandomWallet();
            attempts++;
        }
        let encWallet = generateWallet(wallet.privKey, password, wallet.address);
        wallets += JSON.stringify(encWallet, null, 4) + ',' + '\n';
        addresses += '0x' + toChecksumAddress(wallet.address) + '\n';
        completions++;
        console.log(completions + ' addresses found');
    }
    console.log(addresses);

    cb({ address: '0x' + toChecksumAddress(wallet.address), privKey: wallet.privKey, attempts, wallets: wallets });
};

self.onmessage = (event) => {
    console.log('Onmessage called');
    const input = event.data;
    try {
        getVanityWallet(input.hex, input.checksum, input.suffix, (message) => postMessage(message));
    } catch (err) {
        self.postMessage({ error: err.toString() });
    }
};

function generateWallet(privateKey, password, address) {
    privateKey = Buffer.from(privateKey, 'hex');
    return {
        address: address,
        crypto: encryptPrivateKey(privateKey, password),
        id: v4(),
        version: 3,
    };
}

function sliceWordArray(wordArray, start, end) {
    const newArray = wordArray.clone();
    newArray.words = newArray.words.slice(start, end);
    newArray.sigBytes = (end - start) * 4;
    return newArray;
}

function encryptPrivateKey(privateKey, password) {
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(32);
    const key = CryptoJS.PBKDF2(password, salt, {
        keySize: 8,
        hasher: CryptoJS.algo.SHA256,
        iterations: 262144,
    });
    const cipher = CryptoJS.AES.encrypt(CryptoJS.enc.Hex.parse(privateKey.toString('hex')), sliceWordArray(key, 0, 4), {
        iv: iv,
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding,
    });
    // eslint-disable-next-line new-cap
    const mac = CryptoJS.SHA3(sliceWordArray(key, 4, 8).concat(cipher.ciphertext), {
        outputLength: 256,
    });

    return {
        kdf: 'pbkdf2',
        kdfparams: { c: 262144, dklen: 32, prf: 'hmac-sha256', salt: salt.toString() },
        cipher: 'aes-128-ctr',
        ciphertext: cipher.ciphertext.toString(),
        cipherparams: { iv: iv.toString() },
        mac: mac.toString(),
    };
}
