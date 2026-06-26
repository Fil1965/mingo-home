import fs from 'fs/promises';
import path from 'path';
import logger from './logger.mjs';

class AlertManager {
    constructor(dirname) {
        this.fic = path.join(dirname, 'notifications.json');
        this.alerts = [];
    }

    async load(adminList = []) {
        try {
            const data = await fs.readFile(this.fic, 'utf8');
            this.alerts = JSON.parse(data);

            // Cleanup: If an adminList is provided, remove alerts already acked by all
            if (adminList.length > 0) {
                const initialCount = this.alerts.length;
                this.alerts = this.alerts.filter(alert => {
                    const allAcked = adminList.every(admin => alert.ackedBy.includes(admin));
                    return !allAcked;
                });
                if (this.alerts.length < initialCount) {
                    logger.info(`[AlertManager] Limpiadas ${initialCount - this.alerts.length} alertas antiguas ya confirmadas.`);
                    await this.save();
                }
            }
        } catch (e) {
            this.alerts = [];
        }
    }

    async save() {
        try {
            await fs.writeFile(this.fic, JSON.stringify(this.alerts, null, 2), 'utf8');
        } catch (e) {
            logger.error('Error saving alerts:', e.message);
        }
    }

    async addAlert(msg, category = 'info') {
        // Prevent duplicate alerts with the same message within a short timeframe (1 hour)
        const now = Date.now();
        const duplicate = this.alerts.find(a => a.msg === msg && (now - new Date(a.timestamp).getTime()) < 3600000);
        if (duplicate) return;

        const id = now.toString();
        this.alerts.push({
            id,
            msg,
            category,
            timestamp: new Date().toISOString(),
            ackedBy: []
        });

        // Keep only last 50 alerts
        if (this.alerts.length > 50) this.alerts.shift();

        await this.save();
    }

    getAlertsForUser(username) {
        return this.alerts.filter(a => !a.ackedBy.includes(username));
    }

    async acknowledge(alertId, username, adminList = []) {
        const alertIndex = this.alerts.findIndex(a => a.id == alertId);
        if (alertIndex !== -1) {
            const alert = this.alerts[alertIndex];
            if (!alert.ackedBy.includes(username)) {
                alert.ackedBy.push(username);
            }

            // Check if all current admins have acknowledged
            // We only filter admins that are actually in the adminList
            const allAcked = adminList.every(admin => alert.ackedBy.includes(admin));

            if (allAcked && adminList.length > 0) {
                logger.info(`[AlertManager] Alerta ${alertId} confirmada por todos los admins. Eliminando.`);
                this.alerts.splice(alertIndex, 1);
            }

            await this.save();
            return true;
        }
        return false;
    }
}

export default AlertManager;
