document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const GITHUB_USERNAME = "thunderbeanage";
    const GITHUB_REPO = "fireteam-finder";
    const API_KEY = "235da8022fe042c784eab8ab3ab45d7e";
    const OAUTH_CLIENT_ID = "49947";
    const REDIRECT_URI = `https://${GITHUB_USERNAME}.github.io/${GITHUB_REPO}/`;
    const BUNGIE_AUTH_URL = `https://www.bungie.net/en/OAuth/Authorize?client_id=${OAUTH_CLIENT_ID}&response_type=code`;
    const BUNGIE_API_BASE = "https://www.bungie.net/Platform";

    // --- STATE ---
    let currentPage = 0;
    let membershipInfo = null;
    let characterId = null;
    let accessToken = null;
    const activityDefinitionCache = new Map();

    // --- DOM ELEMENTS ---
    const loginButton = document.getElementById('login-button');
    const loginContainer = document.getElementById('login-container');
    const loadingIndicator = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const activityHistoryContainer = document.getElementById('activity-history');
    const activitiesContainer = document.getElementById('activities-container');
    const paginationContainer = document.getElementById('pagination-container');
    const loadMoreButton = document.getElementById('load-more-button');
    const loadingMoreSpinner = document.getElementById('loading-more');
    const searchBar = document.getElementById('search-bar');
    const searchButton = document.getElementById('search-button');

    // --- HELPER FUNCTIONS ---
    /**
     * Shows a specific section and hides others.
     * @param {HTMLElement} elementToShow The element to display.
     */
    const showSection = (elementToShow) => {
        loginContainer.classList.add('hidden');
        loadingIndicator.classList.add('hidden');
        errorMessage.classList.add('hidden');
        activityHistoryContainer.classList.add('hidden');
        if (elementToShow) {
            elementToShow.classList.remove('hidden');
        }
    };
    
    /**
     * Makes a request to the Bungie API.
     * @param {string} url The URL to fetch.
     * @param {string} token The OAuth access token (optional for public endpoints).
     * @returns {Promise<any>} The JSON response from the API.
     */
    const bungieApiRequest = async (url, token = null) => {
        const headers = { "X-API-Key": API_KEY };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Bungie API request failed: ${response.statusText}`);
        const data = await response.json();
        if (data.ErrorCode !== 1) throw new Error(`Bungie API Error: ${data.Message}`);
        return data.Response;
    };

    /**
     * Fetches the definition for a specific activity from the manifest.
     * @param {string} activityHash The hash of the activity.
     * @returns {Promise<object>} The activity definition.
     */
    const getActivityDefinition = async (activityHash) => {
        if (activityDefinitionCache.has(activityHash)) {
            return activityDefinitionCache.get(activityHash);
        }
        const url = `${BUNGIE_API_BASE}/Destiny2/Manifest/DestinyActivityDefinition/${activityHash}/`;
        const definition = await bungieApiRequest(url);
        activityDefinitionCache.set(activityHash, definition);
        return definition;
    };

    // --- CORE LOGIC ---
    /**
     * Fetches a page of activities and renders them.
     * @param {number} page The page number to fetch.
     */
    const fetchAndRenderActivities = async (page) => {
        try {
            loadMoreButton.disabled = true;
            loadingMoreSpinner.classList.remove('hidden');

            const recentActivities = await getActivityHistory(accessToken, membershipInfo.membershipType, membershipInfo.membershipId, characterId, page);

            if (recentActivities.length === 0 && page > 0) {
                loadMoreButton.textContent = "No More Activities";
                paginationContainer.classList.remove('hidden');
                loadingMoreSpinner.classList.add('hidden');
                return; 
            }
             if (recentActivities.length === 0 && page === 0) {
                activitiesContainer.innerHTML = "<p>No recent activities found for this character.</p>";
                 paginationContainer.classList.add('hidden');
            }
            
            const activitiesWithDetails = await Promise.all(recentActivities.map(async (activity) => {
                const fireteam = await getPostGameCarnageReport(accessToken, activity.activityDetails.instanceId);
                const definition = await getActivityDefinition(activity.activityDetails.directorActivityHash);
                return { ...activity, fireteam, definition };
            }));

            renderActivities(activitiesWithDetails);
            
            showSection(activityHistoryContainer);
            paginationContainer.classList.remove('hidden');
            loadMoreButton.disabled = false;
            // After rendering, apply the current search filter
            applySearchFilter();

        } catch (error) {
            console.error("An error occurred while fetching activities:", error);
            errorMessage.querySelector('p').textContent = `An error occurred: ${error.message}`;
            showSection(errorMessage);
        } finally {
            loadingMoreSpinner.classList.add('hidden');
        }
    };
    
    /**
     * Exchanges the authorization code for an access token.
     * @param {string} authCode The authorization code from the Bungie redirect.
     * @returns {Promise<string>} The access token.
     */
    const getAccessToken = async (authCode) => {
        const response = await fetch(`${BUNGIE_API_BASE}/app/oauth/token/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', "X-API-Key": API_KEY },
            body: `grant_type=authorization_code&code=${authCode}&client_id=${OAUTH_CLIENT_ID}`
        });
        if (!response.ok) throw new Error('Failed to fetch access token');
        const data = await response.json();
        return data.access_token;
    };
    
    /**
     * Fetches the user's primary Destiny membership information.
     * @param {string} token The OAuth access token.
     * @returns {Promise<object>} An object containing membershipType and membershipId.
     */
    const getMembershipInfo = async (token) => {
        const userResponse = await bungieApiRequest(`${BUNGIE_API_BASE}/User/GetMembershipsForCurrentUser/`, token);
        const destinyMembership = userResponse.destinyMemberships[0];
        if (!destinyMembership) throw new Error("No Destiny 2 account found for this Bungie user.");
        return { membershipType: destinyMembership.membershipType, membershipId: destinyMembership.membershipId };
    };

    /**
     * Fetches the character IDs for a given user.
     * @param {string} token The OAuth access token.
     * @param {number} membershipType The user's membership type.
     * @param {string} membershipId The user's membership ID.
     * @returns {Promise<string[]>} A list of character IDs.
     */
     const getCharacterIds = async (token, membershipType, membershipId) => {
        const profileUrl = `${BUNGIE_API_BASE}/Destiny2/${membershipType}/Profile/${membershipId}/?components=Characters`;
        const profileResponse = await bungieApiRequest(profileUrl, token);
        return Object.keys(profileResponse.characters.data);
     };

    /**
     * Fetches the recent activity history for a character.
     * @param {string} token The OAuth access token.
     * @param {number} membershipType The user's membership type.
     * @param {string} membershipId The user's membership ID.
     * @param {string} charId The character's ID.
     * @param {number} page The page number to fetch.
     * @returns {Promise<object[]>} A list of activity data.
     */
    const getActivityHistory = async (token, membershipType, membershipId, charId, page) => {
        const activityUrl = `${BUNGIE_API_BASE}/Destiny2/${membershipType}/Account/${membershipId}/Character/${charId}/Stats/Activities/?count=10&page=${page}`;
        const activityResponse = await bungieApiRequest(activityUrl, token);
        return activityResponse.activities || [];
    };

    /**
     * Fetches the Post Game Carnage Report (PGCR) for a specific activity.
     * @param {string} token The OAuth access token.
     * @param {string} activityId The ID of the activity instance.
     * @returns {Promise<object[]>} A list of players in the activity.
     */
    const getPostGameCarnageReport = async (token, activityId) => {
        const pgcrUrl = `https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${activityId}/`;
        const pgcrResponse = await bungieApiRequest(pgcrUrl, token);
        return pgcrResponse.entries || [];
    };

    /**
     * Renders the fetched activities and their fireteams onto the page.
     * @param {Array} activitiesWithDetails - An array of activity objects, each with 'fireteam' and 'definition' properties.
     */
    const renderActivities = (activitiesWithDetails) => {
        activitiesWithDetails.forEach(activity => {
            const card = document.createElement('div');
            card.className = 'activity-card';
            const activityDate = new Date(activity.period).toLocaleString();
            const activityName = activity.definition.displayProperties.name || 'Classified Activity';
            card.setAttribute('data-activity-name', activityName.toLowerCase());


            let playersHtml = '<ul class="player-list">';
            activity.fireteam.forEach(player => {
                const displayName = player.player.destinyUserInfo.bungieGlobalDisplayName;
                const displayNameCode = player.player.destinyUserInfo.bungieGlobalDisplayNameCode;
                const fullBungieId = `${displayName}#${displayNameCode}`;
                const playerIcon = player.player.destinyUserInfo.iconPath ? `https://www.bungie.net${player.player.destinyUserInfo.iconPath}` : '';
                playersHtml += `
                    <li class="player-item">
                        <img src="${playerIcon}" class="player-icon" onerror="this.style.display='none'">
                        <div class="player-info">
                            <h4>${fullBungieId}</h4>
                            <p>Character ID: ${player.characterId}</p>
                        </div>
                    </li>`;
            });
            playersHtml += '</ul>';

            card.innerHTML = `
                <div class="activity-header">
                    <h3>${activityName}</h3>
                    <p>Completed: ${activityDate}</p>
                </div>
                ${playersHtml}`;

            activitiesContainer.appendChild(card);
        });
    }

    /**
     * Filters the visible activity cards based on the search bar's value.
     */
    const applySearchFilter = () => {
        const searchTerm = searchBar.value.toLowerCase();
        const activityCards = document.querySelectorAll('.activity-card');
        activityCards.forEach(card => {
            const activityName = card.getAttribute('data-activity-name');
            if (activityName.includes(searchTerm)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    };

    /**
     * Main function to orchestrate the initial data fetch.
     * @param {string} token The OAuth access token.
     */
    const main = async (token) => {
        try {
            showSection(loadingIndicator);
            accessToken = token;
            membershipInfo = await getMembershipInfo(accessToken);
            const characterIds = await getCharacterIds(accessToken, membershipInfo.membershipType, membershipInfo.membershipId);
            if (!characterIds.length) throw new Error("No characters found on this account.");
            characterId = characterIds[0]; // Using the first character for simplicity
            
            await fetchAndRenderActivities(currentPage);

        } catch (error) {
            console.error("An error occurred:", error);
            errorMessage.querySelector('p').textContent = `An error occurred: ${error.message}`;
            showSection(errorMessage);
        }
    };

    // --- EVENT LISTENERS & INITIALIZATION ---
    loginButton.addEventListener('click', () => {
        window.location.href = BUNGIE_AUTH_URL;
    });

    loadMoreButton.addEventListener('click', () => {
        currentPage++;
        fetchAndRenderActivities(currentPage);
    });
    
    searchButton.addEventListener('click', applySearchFilter);

    searchBar.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            applySearchFilter();
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');

    if (authCode) {
        history.replaceState(null, '', REDIRECT_URI);
        getAccessToken(authCode).then(main).catch(error => {
            console.error("Failed to get access token:", error);
            errorMessage.querySelector('p').textContent = `Failed to authenticate with Bungie. Please try logging in again.`;
            showSection(errorMessage);
        });
    } else {
        showSection(loginContainer);
    }
});
