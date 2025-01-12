import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

/** Class representing a Cloudflare Bypass. */
class Cloudflare {
    /**
     * @param {string} url
     */
    constructor(url) {
        this.url = url;

        this.started = false;

        this.browser = null;
        this.page = null;
    }

    /** Start the browser. */
    async _startBrowser() {
        if (process.env.ZENROWS_BROWSER) {
            this.browser = await puppeteer.connect(
                {
                    browserWSEndpoint: process.env.ZENROWS_BROWSER,
                }
            );
        } else {
            this.browser = await puppeteer.launch(
                {
                    headless: false,
                }
            );
        }

        this.page = await this.browser.newPage();

        this.started = true;
    }

    /** Close the browser. */
    async _closeBrowser() {
        await this.browser.close();

        this.started = false;
    }

    /** Check if Cloudflare challenge is showing. */
    async isShowingChallenge() {
        await this._startBrowser();

        await this.page.goto(this.url);
        await this.page.waitForNetworkIdle();

        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const schoolSelect = await this.page.$('input[placeholder="Start typing your school\'s name..."]');
        if (!schoolSelect) {
            return {
                showing: true,
            };
        }
        
        await this._closeBrowser();

        return {
            showing: false,
        };
    }
}

export { Cloudflare };