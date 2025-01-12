/** Represents a school. */
class School {
    /**
     * Create a school.
     * 
     * @param {number} id - The ID of the school
     * @param {string} name - The name of the school
     * @param {string} slug - The slug of the school
     * @param {string} town - The town of the school
     * @param {string} address - The address of the school
     * @param {string[]} products - The products of the school
     */
    constructor(id, name, slug, town, address, products) {
        this.id = id;
        this.name = name;
        this.slug = slug;
        this.town = town;
        this.address = address;
        this.products = products;
    }
}

/** 
 * Get schools.
 * 
 * @returns {Promise<School[]>} The schools
 */
async function getSchools() {
    const response = await fetch("https://static.sparxhomework.uk/sl/spx001/data.txt");
    const schools = JSON.parse(Buffer.from(await response.text(), "base64").toString("utf8"));

    return schools.map(school => new School(school.i, school.n, school.u, school.t, school.a, school.p));
}

export { School, getSchools };