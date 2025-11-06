const TIERS = [
  { name: 'Plata', points: 500, key: 'plata' },
  { name: 'Oro', points: 1500, key: 'oro' },
  { name: 'Stars', points: 3000, key: 'stars' },
  { name: 'Diamante', points: 5000, key: 'diamante' },
  { name: 'Corona', points: 10000, key: 'corona' }
];

function getCurrentTier(points, personalPoints) {
  let currentTier = null;
  let nextTier = TIERS[0];

  if (personalPoints < 50) {
    return { currentTier: null, nextTier: TIERS[0] };
  }

  currentTier = { name: 'Masters', points: 0, key: 'masters' };

  for (let i = 0; i < TIERS.length; i++) {
    if (points >= TIERS[i].points) {
      currentTier = TIERS[i];
      nextTier = TIERS[i + 1] || null;
    } else {
      nextTier = TIERS[i];
      break;
    }
  }

  return { currentTier, nextTier };
}

function calculateProgress(points, personalPoints) {
  if (points >= TIERS[TIERS.length - 1].points) {
    return { percentage: 100, tier: TIERS[TIERS.length - 1] };
  }

  const { currentTier, nextTier } = getCurrentTier(points, personalPoints);

  if (!nextTier) {
    return { percentage: 100, tier: currentTier };
  }

  const previousPoints = currentTier ? currentTier.points : 0;
  const targetPoints = nextTier.points;
  const range = targetPoints - previousPoints;
  const progress = points - previousPoints;
  const percentage = (progress / range) * 100;

  return {
    percentage: Math.min(100, Math.max(0, percentage)),
    tier: currentTier || { name: 'Masters', points: 0, key: 'masters' },
    nextTier
  };
}

function updateProgressBar(groupPoints, personalPoints) {
  const progressBarContainer = document.getElementById('progressBarContainer');
  const activationAlert = document.getElementById('activationAlert');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercentage = document.getElementById('progressPercentage');
  const currentTierName = document.getElementById('currentTierName');
  const pointsToNextValue = document.getElementById('pointsToNextValue');

  if (!progressBarContainer || !activationAlert) {
    console.warn('Progress bar elements not found');
    return;
  }

  const points = Number(groupPoints) || 0;
  const personalPts = Number(personalPoints) || 0;

  if (personalPts < 50) {
    progressBarContainer.style.display = 'none';
    activationAlert.style.display = 'block';
    return;
  }

  activationAlert.style.display = 'none';
  progressBarContainer.style.display = 'block';

  const { percentage, tier, nextTier } = calculateProgress(points, personalPts);

  if (progressBarFill) {
    const displayPercentage = nextTier 
      ? Math.round(percentage)
      : 100;
    
    setTimeout(() => {
      progressBarFill.style.width = displayPercentage + '%';
      progressBarFill.setAttribute('data-tier', tier.key);
    }, 100);
  }

  if (progressPercentage) {
    const displayPercentage = nextTier 
      ? Math.round(percentage)
      : 100;
    progressPercentage.textContent = displayPercentage + '%';
  }

  if (currentTierName) {
    currentTierName.textContent = tier.name;
  }

  if (pointsToNextValue) {
    if (nextTier) {
      const pointsNeeded = nextTier.points - points;
      pointsToNextValue.textContent = pointsNeeded;
      document.getElementById('pointsToNext').style.display = 'inline';
    } else {
      document.getElementById('pointsToNext').style.display = 'none';
    }
  }

  const tierMarkers = document.querySelectorAll('.tier-marker');
  tierMarkers.forEach((marker) => {
    const tierPoints = parseInt(marker.getAttribute('data-points'));
    if (points >= tierPoints) {
      marker.classList.add('achieved');
    } else {
      marker.classList.remove('achieved');
    }
  });

  if (points >= TIERS[TIERS.length - 1].points) {
    setTimeout(() => {
      if (window.Swal) {
        Swal.fire({
          icon: 'success',
          title: '¡Felicitaciones!',
          html: '¡Has alcanzado el nivel <strong>Corona</strong>! 👑<br>Eres parte de la élite de PorkCasare.',
          confirmButtonText: 'Genial',
          showClass: {
            popup: 'animate__animated animate__fadeInDown'
          }
        });
      }
    }, 1800);
  }
}

document.addEventListener('pointsReady', (event) => {
  const personalPoints = event.detail.personalPoints || 0;
  const groupPoints = event.detail.groupPoints || 0;
  updateProgressBar(groupPoints, personalPoints);
});

if (typeof window !== 'undefined') {
  window.updateProgressBar = updateProgressBar;
}

export { updateProgressBar, getCurrentTier, calculateProgress, TIERS };
