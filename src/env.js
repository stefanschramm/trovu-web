/** @module Env */

import jsyaml from 'js-yaml';
import Helper from "./helper.js";

/** Set and remember the environment. */

export default class Env {
  /**
   * Set helper variables.
   */
  constructor() {
    this.configUrlTemplate =
      "https://raw.githubusercontent.com/{%github}/trovu-data-user/master/config.yml";
  }

  /**
   * Set the initial class environment vars either from params or from GET hash string.
   *
   * @param {array} [params] - List of parameters to be used in environment.
   */
  async populate(params) {
    if (!params) {
      params = Helper.getUrlParams();
    }

    if (typeof params.github === 'string' && params.github !== '') {
      await this.setWithUserConfigFromGithub(params);
    }

    // Override all with params.
    Object.assign(this, params);

    this.setDefaults();
    this.addFetchUrlToNamespaces();
    this.namespaces = await this.fetchShortcuts(this.namespaces, this.reload, this.debug);
  }

  /**
   * Set default environment variables if they are still empty.
   */
  setDefaults() {
    // Default language.
    if (typeof this.language != "string") {
      this.language = this.getDefaultLanguage();
    }
    // Default country.
    if (typeof this.country != "string") {
      this.country = this.getDefaultCountry();
    }
    // Default namespaces.
    if (typeof this.namespaces != "object") {
      this.namespaces = ["o", this.language, "." + this.country];
    }
    // Default debug.
    if (typeof this.debug != "boolean") {
      this.debug = Boolean(this.debug);
    }
  }

  /**
   * Set the user configuration from their fork in their Github profile.
   *
   * @param {array} params - Here, 'github' and 'debug' will be used
   */
  async setWithUserConfigFromGithub(params) {
    const config = await this.getUserConfigFromGithub(params);
    if (config) {
      Object.assign(this, config);
    }
  }

  /**
   * Get the user configuration from their fork in their Github profile.
   *
   * @param {array} params - Here, 'github' and 'debug' will be used
   * 
   * @return {(object|boolean)} config - The user's config object, or false if fetch failed.
   */
  async getUserConfigFromGithub(params) {
    const configUrl = this.configUrlTemplate.replace("{%github}", params.github);
    const configYml = await Helper.fetchAsync(configUrl, false, params.debug);
    if (configYml) {
      try {
        const config = jsyaml.load(configYml);
        return config;
      }
      catch (error) {
        alert('Error parsing ' + configUrl + ":\n\n" + error.message);
        return false;
      }
    } else {
      alert("Failed to read Github config from " + configUrl);
      return false;
    }
  }

  // Param getters ====================================================

  /**
   * Get the default language and country from browser.
   *
   * @return {object} [language, country] - The default language and country.
   */
  getDefaultLanguageAndCountry() {
    let { language, country } = this.getLanguageAndCountryFromBrowser();

    // Set defaults.
    language = language || "en";
    country = country || "us";

    // Ensure lowercase.
    language = language.toLowerCase();
    country = country.toLowerCase();

    return { language, country };
  }

  /**
   * Get the default language and country from browser.
   *
   * @return {object} [language, country] - The default language and country.
   */
  getLanguageAndCountryFromBrowser() {
    const languageStr = this.getNavigatorLanguage();
    let language, country;
    if (languageStr) {
      [language, country] = languageStr.split("-");
    }
    return { language, country };
  }

  /**
   * Wrapper for navigator language, capsuled to enable unit testing.
   *
   * @return {string} navigatorLanguage - The browser's value of navigator.language.
   */
  getNavigatorLanguage() {
    const languageStr = navigator.language;
    return languageStr;
  }

  /**
   * Get the default language.
   *
   * @return {string} language - The default language.
   */
  getDefaultLanguage() {
    const { language } = this.getDefaultLanguageAndCountry();
    return language;
  }

  /**
   * Get the default country.
   *
   * @return {string} language - The default country.
   */
  getDefaultCountry() {
    const { country } = this.getDefaultLanguageAndCountry();
    return country;
  }

  /**
   * Start fetching shortcuts per namespace.
   * 
   * @param {array} namespaces - The namespaces to fetch shortcuts for.
   * @param {boolean} reload   - Flag whether to call fetch() with reload. Otherwise, it will be called with 'force-cache'.
   * 
   * @return {array} promises - The promises from the fetch() calls.
   */
  async startFetches(namespaces, reload) {
    const promises = [];
    namespaces.forEach((namespace, i, namespaces) => {
      if (!namespace.url) {
        return namespaces;
      }
      promises.push(
        fetch(namespace.url, { cache: reload ? "reload" : "force-cache" })
      );
    });
    return promises;
  }

  /**
   * Ensure shortcuts have the correct structure.
   * 
   * @param {array} shortcuts      - The shortcuts to normalize.
   * @param {string} namespaceName - The namespace name to show in error message.
   * 
   * @return {array} shortcuts - The normalized shortcuts.
   */
  normalizeShortcuts(shortcuts, namespaceName) {
    const incorrectKeys = [];
    for (let key in shortcuts) {
      if (!key.match(/\S+ \d/)) {
        incorrectKeys.push(key);
      }
      // Check for 'only URL' shortcuts.
      if (typeof shortcuts[key] === 'string') {
        const url = shortcuts[key];
        shortcuts[key] = {
          url: url
        }
      }
    }
    if (incorrectKeys.length > 0) {
      alert(
        "Incorrect keys found in namespace '" + namespaceName +  "'. Keys must have the form 'KEYWORD ARGCOUNT', e.g.: 'foo 0'" + 
        "\n\n" +
        incorrectKeys.join("\n")
      );
    }
    return shortcuts;
  }

  /**
   * Add a fetch URL template to a namespace.
   * 
   * @param {array} namespaces - The namespaces to fetch shortcuts for.
   * @param {boolean} reload   - Flag whether to call fetch() with reload. Otherwise, it will be called with 'force-cache'.
   * @param {boolean} debug    - Flag whether to print debug messages.
   * 
   * @return {array} namespaces - The namespaces with their fetched shortcuts, in a new property namespace.shortcuts.
   */
  async fetchShortcuts(namespaces, reload, debug) {

    const promises = await this.startFetches(namespaces, reload);

    // Wait until all fetch calls are done.
    const responses = await Promise.all(promises);

    for (let i in namespaces) {
      if ((!responses[i]) || (responses[i].status != 200)) {
        if (debug) Helper.log((reload ? "reload " : "cache  ") + "Fail:    " + namespaces[i].url);
        // Mark namespace for deletion.
        namespaces[i] = undefined;
        continue;
      }
      if (debug) Helper.log((reload ? "reload " : "cache  ") + "Success: " + responses[i].url);
      if (!debug) {
        Helper.log(".", false);
      }
      const text = await responses[i].text();
      let shortcuts;
      try {
        shortcuts = jsyaml.load(text);
      }
      catch (error) {
        alert('Error parsing ' + namespaces[i].url + ":\n\n" + error.message);
        namespaces[i] = undefined;
        continue;
      }
      namespaces[i].shortcuts = this.normalizeShortcuts(shortcuts, namespaces[i].name);
    };
    // Delete marked namespaces.
    namespaces = namespaces.filter(namespace => typeof namespace !== 'undefined');
    return namespaces;
  }

  /**
   * To every namespace, add a fetch URL template.
   */
  addFetchUrlToNamespaces() {
    this.namespaces.forEach((namespace, i, namespaces) => {
      namespace = this.addFetchUrlToNamespace(namespace);
      namespaces[i] = namespace;
    });
  }

  /**
   * Add a fetch URL template to a namespace.
   * 
   * @param {(string|Object)} namespace - The namespace to add the URL template to.
   * 
   * @return {Object} namespace - The namespace with the added URL template.
   */
  addFetchUrlToNamespace(namespace) {
    // Site namespaces:
    if (typeof namespace == "string" && namespace.length < 4) {
      namespace = this.addFetchUrlToSiteNamespace(namespace);
      return namespace;
    } 
    // User namespace 1 – custom URL:
    if (namespace.url && namespace.name) {
      // Just add the type.
      namespace.type = "user";
      return namespace;
    }
    // Now remains: User namespace 2 – Github:
    if (typeof namespace == "string") {
      // Create an object.
      namespace = { github: namespace };
    }
    namespace = this.addFetchUrlToGithubNamespace(namespace);
    return namespace;
  }

  /**
   * Add a URL template to a namespace that refers to a namespace in trovu-data.
   *
   * @param {string} name - The namespace name.
   * 
   * @return {Object} namespace - The namespace with the added URL template.
   */
  addFetchUrlToSiteNamespace(name) {
    const namespace = {
      name: name,
      type: "site",
      url:
        "https://raw.githubusercontent.com/trovu/trovu-data/master/shortcuts/" +
        name +
        ".yml"
    };
    return namespace;
  }

  /**
   * Add a URL template to a namespace that refers to a Github user repo.
   *
   * @param {string} name - The namespace name.
   * 
   * @return {Object} namespace - The namespace with the added URL template.
   */
  addFetchUrlToGithubNamespace(namespace) {
    if (namespace.github == ".") {
      // Set to current user.
      namespace.github = this.github;
    }
    // Default name to Github name.
    if (!namespace.name) {
      namespace.name = namespace.github;
    }
    namespace.url =
      "https://raw.githubusercontent.com/" +
      namespace.github +
      "/trovu-data-user/master/shortcuts.yml";
    namespace.type = "user";
    return namespace;
  }

  /**
   * Export current class without methods.
   *
   * @return {object} - Object of env without methods.
   */
  get withoutMethods() {
    const envWithoutFunctions = {};
    for (const key of Object.keys(this)) {
      if (typeof this[key] != "function") {
        envWithoutFunctions[key] = this[key];
      }
    }
    return envWithoutFunctions;
  }
}