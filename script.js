document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const GITHUB_USERNAME = "thunderbeanage";
    const GITHUB_REPO = "fireteam-finder";
    const API_KEY = "235da8022fe042c784eab8ab3ab45d7e";
    const OAUTH_CLIENT_ID = "49947";
    const REDIRECT_URI = `https://${GITHUB_USERNAME}.github.io/${GITHUB_REPO}/`;
    const BUNGIE_AUTH_URL = `https://www.bungie.net/en/OAuth/Authorize?client_id=${OAUTH_CLIENT_ID}&response_type=code`;
    const BUNGIE_API_BASE = "https://www.bungie.net/Platform";

    // --- DOM ELEMENTS ---
    const loginButton = document.getElementById('login-button');
    const loginContainer = document.getElementById('login-container');
    const loadingIndicator = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const activityHistoryContainer = document.getElementById('activity-history');
    const activitiesContainer = document.getElementById('activities-container');

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
     * @param {string} accessToken The OAuth access token.
     * @returns {Promise<any>} The JSON response from the API.
     */
    const bungieApiRequest = async (url, accessToken) => {
        const headers = {
            "X-API-Key": API_KEY
        };
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`Bungie API request failed: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.ErrorCode !== 1) {
             throw new Error(`Bungie API Error: ${data.Message}`);
        }
        return data.Response;
    };

    // --- CORE LOGIC ---
    /**
     * Handles the login button click by redirecting to Bungie for authentication.
     */
    loginButton.addEventListener('click', () => {
        window.location.href = BUNGIE_AUTH_URL;
    });
    
    /**
     * Exchanges the authorization code for an access token.
     * @param {string} authCode The authorization code from the Bungie redirect.
     * @returns {Promise<string>} The access token.
     */
    const getAccessToken = async (authCode) => {
        const response = await fetch(`${BUNGIE_API_BASE}/app/oauth/token/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                "X-API-Key": API_KEY
            },
            body: `grant_type=authorization_code&code=${authCode}&client_id=${OAUTH_CLIENT_ID}`
        });

        if (!response.ok) {
            throw new Error('Failed to fetch access token');
        }

        const data = await response.json();
        return data.access_token;
    };
    
    /**
     * Fetches the user's primary Destiny membership information.
     * @param {string} accessToken The OAuth access token.
     * @returns {Promise<object>} An object containing membershipType and membershipId.
     */
    const getMembershipInfo = async (accessToken) => {
        const userResponse = await bungieApiRequest(`${BUNGIE_API_BASE}/User/GetMembershipsForCurrentUser/`, accessToken);
        const destinyMembership = userResponse.destinyMemberships[0];
        if (!destinyMembership) {
            throw new Error("No Destiny 2 account found for this Bungie user.");
        }
        return {
            membershipType: destinyMembership.membershipType,
            membershipId: destinyMembership.membershipId
        };
    };

    /**
     * Fetches the character IDs for a given user.
     * @param {string} accessToken The OAuth access token.
     * @param {number} membershipType The user's membership type.
     * @param {string} membershipId The user's membership ID.
     * @returns {Promise<string[]>} A list of character IDs.
     */
     const getCharacterIds = async (accessToken, membershipType, membershipId) => {
        const profileUrl = `${BUNGIE_API_BASE}/Destiny2/${membershipType}/Profile/${membershipId}/?components=Characters`;
        const profileResponse = await bungieApiRequest(profileUrl, accessToken);
        return Object.keys(profileResponse.characters.data);
     };

    /**
     * Fetches the recent activity history for a character.
     * @param {string} accessToken The OAuth access token.
     * @param {number} membershipType The user's membership type.
     * @param {string} membershipId The user's membership ID.
     * @param {string} characterId The character's ID.
     * @returns {Promise<object[]>} A list of activity data.
     */
    const getActivityHistory = async (accessToken, membershipType, membershipId, characterId) => {
        const activityUrl = `${BUNGIE_API_BASE}/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/?count=10`;
        const activityResponse = await bungieApiRequest(activityUrl, accessToken);
        return activityResponse.activities || [];
    };

    /**
     * Fetches the Post Game Carnage Report (PGCR) for a specific activity.
     * @param {string} accessToken The OAuth access token.
     * @param {string} activityId The ID of the activity instance.
     * @returns {Promise<object[]>} A list of players in the activity.
     */
    const getPostGameCarnageReport = async (accessToken, activityId) => {
        const pgcrUrl = `${BUNGIE_API_BASE}/Destiny2/Stats/PostGameCarnageReport/${activityId}/`;
        const pgcrResponse = await bungieApiRequest(pgcrUrl, accessToken);
        return pgcrResponse.entries || [];
    };

    /**
     * Renders the fetched activities and their fireteams onto the page.
     * @param {Array} activitiesWithFireteams - An array of activity objects, each with a 'fireteam' property.
     */
    const renderActivities = (activitiesWithFireteams) => {
        activitiesContainer.innerHTML = ''; // Clear previous results

        if (activitiesWithFireteams.length === 0) {
            activitiesContainer.innerHTML = '<p>No recent activities found.</p>';
            return;
        }

        activitiesWithFireteams.forEach(activity => {
            const card = document.createElement('div');
            card.className = 'activity-card';

            const activityDate = new Date(activity.period).toLocaleString();
            const activityName = activity.activityDetails.directorActivityHash; // Note: This is a hash. A manifest lookup would be needed for the real name.

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
                    </li>
                `;
            });
            playersHtml += '</ul>';

            card.innerHTML = `
                <div class="activity-header">
                    <h3>Activity ID: ${activityName}</h3>
                    <p>Completed: ${activityDate}</p>
                </div>
                ${playersHtml}
            `;

            activitiesContainer.appendChild(card);
        });
    }

    /**
     * Main function to orchestrate the fetching and displaying of data.
     * @param {string} accessToken The OAuth access token.
     */
    const main = async (accessToken) => {
        try {
            showSection(loadingIndicator);

            const { membershipType, membershipId } = await getMembershipInfo(accessToken);
            const characterIds = await getCharacterIds(accessToken, membershipType, membershipId);

            if (!characterIds.length) {
                throw new Error("No characters found on this account.");
            }

            // Using the first character for simplicity
            const primaryCharacterId = characterIds[0]; 
            const recentActivities = await getActivityHistory(accessToken, membershipType, membershipId, primaryCharacterId);

            const activitiesWithFireteams = [];
            for (const activity of recentActivities) {
                const fireteam = await getPostGameCarnageReport(accessToken, activity.activityDetails.instanceId);
                activitiesWithFireteams.push({ ...activity, fireteam });
            }
            
            renderActivities(activitiesWithFireteams);
            showSection(activityHistoryContainer);

        } catch (error) {
            console.error("An error occurred:", error);
            errorMessage.querySelector('p').textContent = `An error occurred: ${error.message}`;
            showSection(errorMessage);
        }
    };

    // --- INITIALIZATION ---
    /**
     * On page load, check for an OAuth code in the URL.
     */
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');

    if (authCode) {
        // We have a code, let's get the token and run the app
        // Clear the code from the URL for a cleaner look
        history.replaceState(null, '', REDIRECT_URI);
        getAccessToken(authCode).then(accessToken => {
            main(accessToken);
        }).catch(error => {
            console.error("Failed to get access token:", error);
            errorMessage.querySelector('p').textContent = `Failed to authenticate with Bungie. Please try logging in again.`;
            showSection(errorMessage);
        });
    } else {
        // No code, show the login button
        showSection(loginContainer);
    }
});
