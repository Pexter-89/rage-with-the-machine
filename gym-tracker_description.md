# Rage with the machine - gym tracker app

This is a completely new project. Let's create a gym progress tracking app for personal use for me and my partner that works on androids and iphones. You're free to choose the language and architecture according to what you think works best for this.

## description of how I want it to work:
The general idea is to minimize the amount of clicking and bloat and to only include useful features that work as smoothly as possible.
The app opens to a screen with the following choices:
* Buttons to start a session at one of the assigned gyms. The app lists all the assigned locations directly as "Start a session" buttons without the user having to select it separately. There will only be a short list of different gyms we go to, a maximum of 10 gyms which fit on the screen vertically. Clicking the button goes straight into a gym session screen where the user can select an exercise to log.
* A button to browser gym locations. The purpose of separating locations is to be able to define exercises and gym machine properties specific to each gym so the user doesn't need to always check what was the weight of the leg press sled here for example.
* Progress button to see data of all previous logged exercises and some progress graphs. The progress window to be defined later.
* Settings button to open a panel of some settings and preferences. To be defined later.
* I want there to be a functionality where the app can import a markdown or other type of file that contains all the relevant information and specs from that specific exercise machine for setting it up in the gym tracker app. The file is created by Claude based on a photograph the user sends in claude app. The user could set up each gym on the app in their first visit there and later have fully customized selection of exercises specific to that gym. They could add this file in either the gym definition screen or when logging an exercise. Claude needs to categorize every exercise with consistent naming so the same exercise performed at different gyms are still comparable to each other under the same header.


# gym session screen
Initially contains just a button to log a new exercise at the bottom of the screen. Once the user completes an exercise the view goes back to the session screen with the button to log a new exercise being on bottom, and the just logged one being still available above it so that opening a new exercise is always the same button click. The screen shows session start time at the top of the screen.

# exercise logging screen
Initially contains several large vertical scroll wheels that list the exercises defined in that gym location categorized by the broad category that the exercise targets (e.g. legs, torso, shoulders, arms, full body, or some other definitions that you think is sensible). Each exercise name is a button to select that exercise.

Once user selects an exercise, the screen changes to show a horizontal logging row for set of repeats at the bottom of the screen. The row contains weight selection and number of repeats selection. Both need to be usable without having to type a number, with scroll wheels for example but typing a number needs to be an option. The screen should show the last logged values (numbers of sets and repeats, and the range of weights) from the same exercise on top as a reminder of what the performance level was last time. 
Clicking a "complete set" button at the end of the row moves it upwards and adds a new blank log row on the bottom for the next set. The user doesn't need to specifically complete the exercise, they can just go back to the gym session screen and start another one. Everything will be logged once the session is completed. 

# gym locations screen
Contains the button to add a new location at the bottom of the screen and already existing locations above that.

# single gym location screen
Button to open a file browser to upload the exercise files created by claude to upload those into the gym location database. They can also edit the already existing exercises in case something was wrong or has changed. The new file button is at the bottom and the existing exercises on top as a scrollable list of buttons. 

# progress screen
A sliced view of the gym log database where the user can select various slicers to view whatever they want:
* locations
* exercise types
* year
* month
* week

The progress screen should show a graph of progress on the specific exercise in either e1RM or volume load metrics (selectable by user). It should also show the relevant data as a table. I'll let claude figure out the specifics.

# settings screen
* dark or light theme
* location of the file to save progress and data
* anything else?