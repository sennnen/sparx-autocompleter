import { Sparx } from "./Sparx.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";

/** Class representing an Activity. */
class Activity {
    /**
     * Create an Activity.
     * 
     * @param {Sparx} sparxClient - The Sparx client
     * @param {number} taskIndex - The index of the task
     * @param {number} activityIndex - The index of the activity
     * @param {string} id - The ID of the activity
     * @param {string} code - The code of the activity
     * @param {object} layout - The layout of the activity
     */
    constructor(
        sparxClient,
        taskIndex,
        activityIndex,
        id,
        code,
        layout
    ) {
        this.client = sparxClient;
        this.taskIndex = taskIndex;
        this.activityIndex = activityIndex;
        this.id = id;
        this.code = code;
        this.layout = layout;
    }

    async registerStart() {
        return this.client.registerActivityStart(this.activityIndex);
    }

    async getAnswers() {
        if (this.layout[0].layout.type.includes("multiple-choice") || this.layout[0].layout.type.includes("multi-part")) {
            // This quesion is a multiple choice question
            const answers = calculateMultipleChoiceAnswer(this.layout[0]);
            if (answers) {
                return answers;
            }
        }

        const question = this.layout[0].layout.content[0].content[0].content[0].text;

        let imageUrl;
        if (this.layout[0].layout.content[0].content.length >= 2 && this.layout[0].layout.content[0].content[1].type.includes("question-image")) {
            imageUrl = "https://assets.sparxhomework.uk/" + this.layout[0].layout.content[0].content[1].figure.image;
        }

        const numberFieldIds = Object.keys(this.layout[0].input.number_fields);

        const results = await getAnswerFromAI(question, this.layout[0], numberFieldIds.length, imageUrl);
        if (results.length === 0) return;

        const answers = {};

        for (const result of results) {
            answers[result.id] = result.answer;
        }

        return answers;
    }

    async submitAnswers(answers) {
        return this.client.submitAnswer(this.activityIndex, answers);
    }
}

/** Calculate the answer for a multiple choice question. */
function calculateMultipleChoiceAnswer(layoutInfo) {
    const answerIds = [];

    if (layoutInfo.input.choice_groups.choice_group) {
        if (layoutInfo.input.choice_groups.choice_group.max_choices && layoutInfo.input.choice_groups.choice_group.max_choices !== 1) return;
        answerIds.push(layoutInfo.input.choice_groups.choice_group.choice_refs[0]);
    } else {
        const acceptCounts = {};
        for (const answerContent of layoutInfo.layout.content[1].content[0].content) {
            if (!answerContent.type.includes("answer-part")) continue;

            for (const answerPartContent of answerContent.content) {
                if (answerPartContent.element !== "slot") continue;

                if (acceptCounts[answerPartContent.accept]) {
                    acceptCounts[answerPartContent.accept] += 1;
                } else {
                    acceptCounts[answerPartContent.accept] = 1;
                }
            }
        }

        for (const acceptKey of Object.keys(acceptCounts)) {
            const cardGroupKey = Object.keys(layoutInfo.input.card_groups).find(cardGroupKeSearch => cardGroupKeSearch === acceptKey);
            if (!cardGroupKey) continue;

            const cardGroup = layoutInfo.input.card_groups[cardGroupKey];

            for (let i = 0; i < acceptCounts[acceptKey]; i++) {
                answerIds.push(cardGroup.card_refs[i]);
            }
        }
    }

    const answers = {};

    for (const answerId of answerIds) {
        let slotId;
        for (const [cardGroupId, cardGroupData] of Object.entries(layoutInfo.input.card_groups)) {
            if (cardGroupData.card_refs.includes(answerId)) {
                slotId = cardGroupId;
                break;
            }
        }

        let answerContent;
        if (layoutInfo.input.cards[answerId]) {
            answerContent = layoutInfo.input.cards[answerId].content[0].text;
        } else if (layoutInfo.input.choices[answerId]) {
            answerContent = layoutInfo.input.choices[answerId].content[0].text;
        }

        if (slotId) {
            answers[slotId] = answerId;
        } else {
            answers[answerId] = answerContent;
        }
    }

    return Object.keys(answers).length > 0 ? answers : null;
}

/** 
 * Get an answer from the AI.
 * 
 * @param {string} question - The question
 * @param {object} layoutInfo - The layout information
 * @param {number} outputLength - The required output length
 * @param {string} imageUrl - The image URL
 */
async function getAnswerFromAI(question, layoutInfo, outputLength, imageUrl) {
    await new Promise(resolve => setTimeout(resolve, 4000));

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: {
                type: "object",
                properties: {
                    answers: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string"
                                },
                                answer: {
                                    type: "string"
                                }
                            },
                            required: [
                                "id",
                                "answer"
                            ]
                        }
                    }
                },
                required: [
                    "answers"
                ]
            },
        },
    });

    let answerScreen = '';
    if (layoutInfo.layout.content.find(content => content.type.includes("answer"))) {
        const answerContent = layoutInfo.layout.content.find(content => content.type.includes("answer"));
        const answerScreenInfo = answerContent.content.find(content => {
            if (!content.type) return false;
            return content.type.includes("answer-screen");
        });

        if (answerScreenInfo) {
            for (const answerPart of answerScreenInfo.content.filter(content => content.type.includes("answer-part"))) {
                const fieldId = answerPart.content.find(content => content.element.includes("field")).ref;
                const answerPartText = answerPart.content.find(content => content.element == "text")?.text || '';

                answerScreen += `${fieldId}: ${answerPartText}\n`;
            }

            if (answerScreen.length > 0 && answerScreenInfo.content.filter(content => content.type.includes("cards")).length > 0) {
                answerScreen += "\n";
            }

            for (const cardsPart of answerScreenInfo.content.filter(content => content.type.includes("cards"))) {
                const cardsId = cardsPart.id;

                for (const cardPart of cardsPart.content.filter(content => content.element === "card")) {
                    const cardId = cardPart.ref;
                    const cardPartText = cardPart.content.find(content => content.element === "text").text;

                    answerScreen += `${cardsId}: ${cardPartText} (${cardId})\n`;
                }
            }
        }
    }

    const prompt = `You must add a new element to the output array for each answer no matter the nesting. You have been given the 3 letter ID for each answer. Each ID must only be used once. If there are multiple of the same IDs but with different values below, another unique 3 letter ID will be placed within brackets next to the answer; in this case, the ID must be set to the 3 letters preceding the colon and the answer must be set to the 3 letters inside the brackets next to the corresponding answer that you pick: this means it is a multiple choice question. Answers must be in plain text without any explanation. Answers must not have any spaces in them. Do not describe how you got to the answer. The output array length must be exactly equal to ${outputLength}. You must split fractions at the slash in order to fulfill this length (e.g. [25/9] becomes [25, 9]). ${imageUrl ? 'Use the image to help answer the question as it provides vital information. ' : ''}If the question results in variables being equal to something, only output the plain number in the order that the variables appear in the question asked. Make sure to follow these rules and solve the following question:\n\n${question}\n\n${answerScreen}`;

    let image;
    if (imageUrl) {
        const imageRequest = await fetch(imageUrl);
        const imageBlob = await imageRequest.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString("base64");

        image = {
            inlineData: {
                data: imageBase64,
                mimeType: 'image/png',
            }
        }
    }

    const result = await model.generateContent(
        imageUrl ? [image, prompt] : [prompt]
    );

    const jsonOutput = JSON.parse(result.response.text());

    return jsonOutput.answers;
}

export { Activity };