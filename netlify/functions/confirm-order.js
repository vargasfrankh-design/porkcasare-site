
/**
 * confirm-order.js
 * Version: updated replacement implementing:
 * - POINT_VALUE = 2800
 * - INITIAL_BONUS_POINTS = 20 (40% of 50)
 * - REBUY_BASE_POINTS = 1 (1 point paid per level on recompras)
 * - LEVELS: 5 levels, each receives 1 point ($2,800) for recompras
 *
 * This file is written to replace the existing confirm-order file per user's request.
 *
 * IMPORTANT:
 * - Assumes Mongoose models: Usuario, Orden (Order), Confirmation
 * - Adjust model names/fields if your project uses different identifiers.
 * - Keep a backup of the original file before deployment if you want to revert.
 */

const mongoose = require('mongoose');
// Replace these requires with the actual paths in your project:
const Usuario = require('./models/Usuario'); // user model
const Orden = require('./models/Orden');     // order model
const Confirmation = require('./models/Confirmation'); // audit model

// ======== CONFIG ========
const POINT_VALUE = 2800;            // new point value
const INITIAL_BONUS_POINTS = 20;     // 40% of 50 points
const REBUY_BASE_POINTS = 1;         // for recompras: 1 point per level
const LEVEL_PERCENTS = [1,1,1,1,1];  // 100% (1.0) per level for recompras
const MAX_LEVELS = LEVEL_PERCENTS.length;

// Utility helper
function round(value) {
  return Math.round(value);
}

async function confirmOrder(req, res) {
  try {
    const { action, orderId, adminId } = req.body;

    if (action !== 'confirm') {
      return res.status(400).json({ ok: false, message: 'Invalid action' });
    }

    // Basic validation: implement your admin check here
    const admin = await Usuario.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ ok: false, message: 'Unauthorized' });
    }

    const order = await Orden.findById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    if (order.confirmed) {
      return res.status(400).json({ ok: false, message: 'Order already confirmed' });
    }

    // Begin transaction to update buyer points and mark order
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const buyer = await Usuario.findById(order.buyer).session(session);
      if (!buyer) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ ok: false, message: 'Buyer not found' });
      }

      // Increase buyer's personal points and puntos as before
      // (these field names are kept as 'personalPoints' and 'puntos' — adapt if needed)
      buyer.personalPoints = (buyer.personalPoints || 0) + order.points;
      buyer.puntos = (buyer.puntos || 0) + order.points;

      // If buyer reaches 50 or more, mark initialPackBought (keeps existing behavior)
      if (!buyer.initialPackBought && buyer.personalPoints >= 50) {
        buyer.initialPackBought = true;
      }

      // Mark order as confirmed and save
      order.confirmed = true;
      order.confirmedBy = admin._id;
      order.confirmedAt = new Date();

      // Save buyer and order inside transaction
      await buyer.save({ session });
      await order.save({ session });

      // Create a confirmation audit record
      const confirmRecord = new Confirmation({
        order: order._id,
        buyer: buyer._id,
        admin: admin._id,
        points: order.points,
        createdAt: new Date()
      });
      await confirmRecord.save({ session });

      await session.commitTransaction();
      session.endSession();
    } catch (errTx) {
      await session.abortTransaction();
      session.endSession();
      throw errTx;
    }

    // AFTER transaction: process bonuses/commissions (non-critical)
    // Sponsor (upline) for buyer:
    const buyerLatest = await Usuario.findById(order.buyer);

    // Helper: pay to a sponsor user object and save
    async function paySponsor(sponsorUser, amountValue, basePointsAdded, reason) {
      if (!sponsorUser) return;
      sponsorUser.balance = (sponsorUser.balance || 0) + amountValue;
      sponsorUser.teamPoints = (sponsorUser.teamPoints || 0) + (basePointsAdded || 0);

      // Add history entry if you use history logs
      if (!Array.isArray(sponsorUser.history)) sponsorUser.history = [];
      sponsorUser.history.push({
        date: new Date(),
        action: reason,
        amount: amountValue,
        points: basePointsAdded || 0,
      });

      await sponsorUser.save();
    }

    // ====== BONO DE INICIO RÁPIDO ======
    // Condition: order.points === 50 && order.isInitial && sponsor exists && initialBonusPaid flag false
    if (order.points === 50 && order.isInitial && order.sponsor) {
      if (!order.initialBonusPaid) {
        const sponsor = await Usuario.findById(order.sponsor);
        if (sponsor) {
          const bonusValue = INITIAL_BONUS_POINTS * POINT_VALUE; // 20 * 2800 = 56,000
          await paySponsor(sponsor, bonusValue, INITIAL_BONUS_POINTS, 'Bono inicio rápido (20 pts)');
          order.initialBonusPaid = true;
          await order.save();
        }
      }
    }

    // ====== COMISIONES MULTINIVEL PARA RECOMPRAS ======
    // Per the user's specification:
    // - For recompras (order.isInitial === false OR however your system marks a repurchase),
    //   each level up to 5 receives REBUY_BASE_POINTS * POINT_VALUE * percent
    // - And percent for each level in LEVEL_PERCENTS is 1 (100%) so each gets 1 point ($2800)
    // We'll consider a recomprass as: order.isInitial === false
    if (!order.isInitial) {
      let currentSponsorId = buyerLatest.sponsor || order.sponsor || null;
      for (let level = 0; level < MAX_LEVELS; level++) {
        if (!currentSponsorId) break;
        const sponsorUser = await Usuario.findById(currentSponsorId);
        if (!sponsorUser) break;

        const percent = LEVEL_PERCENTS[level] || 1;
        const commissionValue = round(REBUY_BASE_POINTS * POINT_VALUE * percent); // 1 * 2800 * 1 = 2800

        await paySponsor(sponsorUser, commissionValue, REBUY_BASE_POINTS, `Comisión recompra nivel ${level+1}`);

        // climb to next upline
        currentSponsorId = sponsorUser.sponsor;
      }
    }

    // Finally respond with success and a small report
    const summary = {
      pointValue: POINT_VALUE,
      initialBonusPoints: INITIAL_BONUS_POINTS,
      initialBonusValue: INITIAL_BONUS_POINTS * POINT_VALUE,
      reBuyPerLevelPoints: REBUY_BASE_POINTS,
      reBuyPerLevelValue: REBUY_BASE_POINTS * POINT_VALUE,
      levelsPaid: MAX_LEVELS
    };

    return res.json({ ok: true, message: 'Order confirmed and payments processed (post-transaction).', summary });

  } catch (err) {
    console.error('Error confirming order:', err);
    return res.status(500).json({ ok: false, message: 'Server error', error: err.message });
  }
}

// If this file is used as a module:
module.exports = confirmOrder;

// If used directly with Express, for convenience export a route attachment helper:
module.exports.registerRoute = function(app, path = '/order/confirm') {
  app.post(path, confirmOrder);
};
