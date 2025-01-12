import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import useProxy from "@lem0-packages/puppeteer-page-proxy";

import { School } from "./School.js";
import { Homework, HomeworkTask } from "./Homework.js";
import { Activity } from "./Activity.js";
import { decodeProtoRecursive, TYPES, encodeProto } from "./Protobuf.js";

puppeteer.use(StealthPlugin());

/** Represents a Sparx login. */
class SparxLogin {
    /**
     * Create a Sparx login instance.
     * 
     * @param {string} username - The username of the client
     * @param {string} password - The password of the client
     * @param {School} school - The school of the client
     */
    constructor(username, password, school) {
        if (!username || !password || !school) {
            throw new TypeError("You must provide a username, password, and school.");
        }

        this.username = username;
        this.password = password;
        this.school = school;

        this.cookies = {
            'live-resolver-school': this.school.slug,
            'cookie_preferences': '{"GA":false,"Hotjar":false,"PT":false,"version":4}',
        };

        this.started = false;
        this.browser = null;
        this.page = null;
    }

    async _startBrowser() {
        this.browser = await puppeteer.launch(
            {
                headless: false,
                // args: ["--proxy-server=" + process.env.PROXY_URL],
            }
        );

        this.page = await this.browser.newPage();
        await useProxy(this.page, process.env.PROXY_URL);

        this.browser.setCookie({
            name: 'live-resolver-school',
            value: this.school.slug,
            domain: '.sparxhomework.uk',
        },
        {
            name: 'cookie_preferences',
            value: '{"GA":true,"Hotjar":true,"PT":true,"version":4}',
            domain: '.sparxhomework.uk',
        });

        this.started = true;
    }

    async _closeBrowser() {
        await this.browser.close();

        this.started = false;
    }

    async getLoginCookies() {
        await this._startBrowser();

        await this.page.goto("https://sparxmaths.uk/student/?s=" + this.school.slug);
        await this.page.waitForSelector('input[name="username"]');

        await this.page.screenshot({ path: "login.png" });
    }
}

export { SparxLogin };