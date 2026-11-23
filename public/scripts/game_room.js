const GameRoom = (function() {
    let user = null;

    const init = function() {
        // Initialize the lobby / game events
        MazeGame.init();

        // Join the game lobby via a web socket
        $("#join-lobby-button").on("click", function() {
            MazeGame.join(user);
        });

        $("#start-signin-button").on("click", function() {
            // Show the signin page
            $("#game-room-start-page").hide();
            $("#game-room-signin-page").show();
            $("#signin-form").get(0).reset();
            $("#signin-message").text("");
        });

        $("#start-register-button").on("click", function() {
            // Show the register page
            $("#game-room-start-page").hide();
            $("#game-room-register-page").show();
            $("#register-form").get(0).reset();
            $("#register-message").text("");
        });

        $(".back-button").on("click", function() {
            // Show the start page
            $("#game-room-start-page").show();
            $("#game-room-signin-page").hide();
            $("#game-room-register-page").hide();
        });

        $("#register-button").on("click", function(e) {
            // Do not submit the form
            e.preventDefault();

            //
            // A. Preparing the user data
            //

            // Get the input fields
            const username = $("#register-username").val().trim();
            const password = $("#register-password").val().trim();
            const confirmPassword = $("#register-confirm").val().trim();

            // Password and confirmation does not match
            if (password != confirmPassword) {
                $("#register-message").text("Passwords do not match.");
                return;
            }
            
            // Create the JSON data
            const json = JSON.stringify({ username, password });

            //
            // B. Sending the AJAX request to the server
            //

            // Send a register request
            fetch("/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: json
            })
                .then((res) => res.json())
                .then((json) => {
                    console.log("Endpoint '/register' -", json); // FOR MARKING - DON'T DELETE

                    //
                    // F. Processing any error returned by the server
                    //
                    if (json.error) {
                        $("#register-message").text(json.error);
                        return;
                    }

                    //
                    // J. Handling the success response from the server
                    //
                    $("#register-form").get(0).reset();
                    $("#register-message").text("Your account has been successfully registered.");
                })
                .catch((err) => {
                    $("#register-message").text(err);
                });
        });

        $("#signin-button").on("click", function(e) {
            // Do not submit the form
            e.preventDefault();

            // Get the input fields
            const username = $("#signin-username").val().trim();
            const password = $("#signin-password").val().trim();

            //
            // A. Preparing the user data
            //

            // Create the JSON data
            const json = JSON.stringify({ username, password });

            //
            // B. Sending the AJAX request to the server
            //
            
            // Send a signin request
            fetch("/signin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: json
            })
                .then((res) => res.json())
                .then((json) => {
                    console.log("Endpoint '/signin' -", json); // FOR MARKING - DON'T DELETE

                    //
                    // F. Processing any error returned by the server
                    //
                    if (json.error) {
                        $("#signin-message").text(json.error);
                        return;
                    }

                    //
                    // H. Handling the success response from the server
                    //

                    // Set the user information
                    user = json.user;
                    showUser();

                    // Show the content page
                    $("#content-message").text("");
                    $("#game-room-signin-page").hide();
                    $("#game-room-content-page").show();
                })
                .catch((err) => {
                    $("#signin-message").text(err);
                });
        });

        // Click event for the signout button
        $("#signout-button").on("click", function(e) {
            e.preventDefault();

            // Send a signout request
            fetch("/signout")
                .then((res) => res.json())
                .then((json) => {
                    console.log("Endpoint '/signout' -", json); // FOR MARKING - DON'T DELETE

                    if (json.error) {
                        console.log(json.error);
                        return;
                    }

                    // Clear the user information and leave the lobby
                    user = null;
                    MazeGame.leave();

                    // Show the start page
                    $("#game-room-content-page").hide();
                    $("#game-room-start-page").show();
                })
                .catch((err) => {
                    console.log(err);
                });
        });
    }

    // Show the user's name and win/loss record on the content page
    const showUser = function() {
        $("#game-room-user-name").text(user.username);
        $("#game-room-user-record").text(`Wins: ${user.wins} \u00b7 Losses: ${user.losses}`);
    };

    const validate = function() {
        // Send a validate request
        fetch("/validate")
            .then((res) => res.json())
            .then((json) => {
                console.log("Endpoint '/validate' -", json); // FOR MARKING - DON'T DELETE

                //
                // C. Processing any error returned by the server
                //

                if (json.error) {
                    console.log(json.error);
                    return;
                }

                //
                // E. Handling the success response from the server
                //

                // Set the user information
                user = json.user;
                showUser();

                // Show the content page
                $("#game-room-start-page").hide();
                $("#game-room-content-page").show();
            })
            .catch((err) => {
                console.log(err);
            });
    }

    // Reload the signed in user (e.g. to show the latest wins and losses)
    const refresh = function() {
        fetch("/validate")
            .then((res) => res.json())
            .then((json) => {
                if (json.error) return;
                user = json.user;
                showUser();
            })
            .catch((err) => console.log(err));
    };

    return { init, validate, refresh };
})();
