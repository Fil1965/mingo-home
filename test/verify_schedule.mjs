function testSchedule() {
    const now = new Date();
    const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 500);
    const delay = nextHour.getTime() - now.getTime();

    console.log(`Current time: ${now.toLocaleString()}`);
    console.log(`Next hour scheduled: ${nextHour.toLocaleString()}`);
    console.log(`Delay in ms: ${delay}`);
    console.log(`Delay in minutes: ${delay / 1000 / 60}`);

    if (delay > 0 && delay <= 3600500) {
        console.log('Test PASSED: Delay is within expected range.');
    } else {
        console.log('Test FAILED: Delay is outside expected range.');
    }
}

testSchedule();
