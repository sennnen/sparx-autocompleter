
# Sparx Maths Autocompleter

**This repository is a proof of concept in it's current state. I will work on it when I get time free from exams.**

**Also stop complaining it doesn't work; if you're that lazy that you can't be bothered to do your own Sparx homework still, go to [SenAI](https://senai.uk).**

[![License](https://img.shields.io/badge/Apache_License_2.0-007EC6?style=for-the-badge&logo=Apache&logoColor=white)](https://www.apache.org/licenses/LICENSE-2.0) [![Node JS](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white
)](https://gemini.google.com/)

A work-in-progress Sparx Maths completer using pure requests and no browser manipulation!

## Roadmap

| Feature          | Working |
|------------------|---------|
| Answer Questions | ⏳      |
| Bookwork Checks  | ✅      |
| Times Tables     |         |
| Sparx Reader     |         |
| Sparx Science    |         |

## Demo

![Demo GIF](https://raw.githubusercontent.com/woody-willis/sparx-autocompleter/refs/heads/main/demo.gif)

## Installation

- Install [NodeJS](https://nodejs.org/en)
- Add credentials to `.env`

```bash
git clone https://github.com/woody-willis/sparx-autocompleter
cd sparx-autocompleter

npm install
npm start
```

If you get an `Error: Failed to login due to unexpected error.`, please wait a few seconds and try again. I'm not entirely sure why this happens but it's probably a security thing within Sparx.
