#!/usr/bin/env node

function getLastGlucose(data) {
    
    var one = data[0];
    var two = data[1];
    var o = {
        delta: one.glucose - two.glucose
        , glucose: one.glucose
    };
    
    return o;
    
}

function setTempBasal(rate, duration) {
    
    maxSafeBasal = Math.min(profile_data.max_basal, 2 * profile_data.max_daily_basal, 4 * profile_data.current_basal);
    
    if (rate < 0) { rate = 0; } // if >30m @ 0 required, zero temp will be extended to 30m instead
    else if (rate > maxSafeBasal) { rate = maxSafeBasal; }
    
    requestedTemp.duration = duration;
    requestedTemp.rate = rate;
    
};

    
if (!module.parent) {
    var iob_input = process.argv.slice(2, 3).pop()
    var temps_input = process.argv.slice(3, 4).pop()
    var glucose_input = process.argv.slice(4, 5).pop()
    var profile_input = process.argv.slice(5, 6).pop()
    
    if (!iob_input || !temps_input || !glucose_input || !profile_input) {
        console.error('usage: ', process.argv.slice(0, 2), '<iob.json> <current-temps.json> <glucose.json> <profile.json>');
        process.exit(1);
    }

    var cwd = process.cwd()
    var glucose_data = require(cwd + '/' + glucose_input);
    var temps_data = require(cwd + '/' + temps_input);
    var iob_data = require(cwd + '/' + iob_input);
    var profile_data = require(cwd + '/' + profile_input);
    
    if (typeof profile_data === 'undefined' || typeof profile_data.current_basal === 'undefined') {
        console.error('Error: could not get current basal rate');
        process.exit(1);
    }

    // if target_bg is set, great. otherwise, if min and max are set, then set target to their average
    var target_bg;
    if (typeof profile_data.target_bg !== 'undefined') {
        target_bg = profile_data.target_bg;
    } else {
        if (typeof profile_data.max_bg !== 'undefined' && typeof profile_data.max_bg !== 'undefined') {
            target_bg = (profile_data.max_bg + profile_data.max_bg) / 2;
        } else {
            console.error('Error: could not determine target_bg');
            process.exit(1);
        }
    }

    var glucose_status = getLastGlucose(glucose_data);
    var bg = glucose_status.glucose
    var eventualBG = bg - (iob_data.iob * profile_data.sens);
    var requestedTemp = {
        'temp': 'absolute'
    };
    
    
        
    //if old reading from Dexcom do nothing
    
    var systemTime = new Date();
    var displayTime = new Date(glucose_data[0].display_time.replace('T', ' '));
    var minAgo = (systemTime - displayTime) / 60 / 1000
    
    if (minAgo < 10 && minAgo > -5 ) { // Dexcom data is recent, but not far in the future

        if (bg < profile_data.min_bg - 30) { // low glucose suspend mode: BG is < ~80
            if (glucose_status.delta > 0) { // if BG is rising
                if (temps_data.rate > profile_data.current_basal) { // if a high-temp is running
                    setTempBasal(0, 0); // cancel it
                } else { // no high-temp
                    console.error("No action required (no high-temp to cancel)")
                }
            }
            else { // if (glucose_status.delta <= 0) { // BG is not yet rising
                setTempBasal(0, 30);
            }
            
        } else {
            
            // if BG is rising but eventual BG is below target, or BG is falling but eventual BG is above target,
            // then cancel any temp basals.
            if ((glucose_status.delta > 0 && eventualBG < profile_data.min_bg) || (glucose_status.delta < 0 && eventualBG >= profile_data.max_bg)) {
                if (temps_data.duration > 0) { // if there is currently any temp basal running
                    setTempBasal(0, 0); // cancel temp
                } else {
                    console.error("No action required (no temp to cancel)")
                }
        
            } else if (eventualBG < profile_data.min_bg) { // if eventual BG is below target:
                // calculate 30m low-temp required to get projected BG up to target
                // negative insulin required to get up to min:
                var insulinReq = Math.max(0, (target_bg - eventualBG) / profile_data.sens);
                // rate required to deliver insulinReq less insulin over 30m:
                var rate = profile_data.current_basal - (2 * insulinReq);

                if (typeof temps_data.rate === 'undefined' || rate < temps_data.rate) { // if required temp < existing temp basal
                    setTempBasal(rate, 30);
                } else {
                    console.error("No action required (existing basal " + temps_data.rate + " <= required temp " + rate + " )")
                }

            } else if (eventualBG > profile_data.max_bg) { // if eventual BG is above target:
                // calculate 30m high-temp required to get projected BG down to target
                // additional insulin required to get down to max:
                var insulinReq = (target_bg - eventualBG) / profile_data.sens;
                // rate required to deliver insulinReq more insulin over 30m:
                var rate = profile_data.current_basal - (2 * insulinReq);
                if (typeof temps_data.rate === 'undefined' || rate > temps_data.rate){ // if required temp > existing temp basal
                    setTempBasal(rate, 30);
                } else {
                    console.error("No action required (existing basal " + temps_data.rate + " >= required temp " + rate + " )")
                }
        
            } else { // if (profile_data.min_bg < eventualBG < profile_data.max_bg) {
                console.error(eventualBG + " is in range. No action required.")
            }
        }
    } else {
        console.error("BG data is too old")
    }
    
    console.log(JSON.stringify(requestedTemp));
}




