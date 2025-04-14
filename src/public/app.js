document.addEventListener('DOMContentLoaded', function() {
    // Initialize date and time
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Initial data load
    loadDashboardData();
    
    // Initialize event listeners
    document.getElementById('refresh-btn').addEventListener('click', loadDashboardData);
    document.getElementById('refresh-positions-btn').addEventListener('click', loadPositionsData);
    document.getElementById('refresh-performance-btn').addEventListener('click', loadPerformanceData);
    document.getElementById('load-chart-btn').addEventListener('click', loadTradingViewChart);
    
    // Initialize tabs
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Hide all tabs
            document.querySelectorAll('.tab-pane').forEach(tab => {
                tab.classList.remove('show', 'active');
            });
            
            // Remove active class from all links
            document.querySelectorAll('.nav-link').forEach(navLink => {
                navLink.classList.remove('active');
            });
            
            // Get the tab to show
            const tabId = this.getAttribute('href');
            const tab = document.querySelector(tabId);
            
            // Show the tab
            tab.classList.add('show', 'active');
            this.classList.add('active');
            
            // Load tab-specific data
            if (tabId === '#positions-tab') {
                loadPositionsData();
            } else if (tabId === '#strategy-performance-tab') {
                loadPerformanceData();
            } else if (tabId === '#chart-tab') {
                loadTradingViewChart();
            }
        });
    });
    
    // Initial chart load
    loadTradingViewChart();
});

// Update date and time
function updateDateTime() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleString();
}

// Load dashboard data
async function loadDashboardData() {
    try {
        const [positionsResponse, performanceResponse] = await Promise.all([
            fetch('/api/positions'),
            fetch('/api/performance')
        ]);
        
        if (!positionsResponse.ok || !performanceResponse.ok) {
            throw new Error('Failed to fetch data');
        }
        
        const positions = await positionsResponse.json();
        const performance = await performanceResponse.json();
        
        // Update dashboard metrics
        updateDashboardMetrics(positions, performance);
        
        // Update recent trades table
        updateRecentTradesTable(positions.closed);
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showError('Failed to load dashboard data');
    }
}

// Update dashboard metrics
function updateDashboardMetrics(positions, performance) {
    // Active positions count
    document.getElementById('active-positions-count').textContent = positions.active.length;
    
    // Calculate overall win rate
    let totalTrades = 0;
    let totalWins = 0;
    let totalPnl = 0;
    
    performance.forEach(perf => {
        totalTrades += perf.totalTrades;
        totalWins += perf.winningTrades;
        totalPnl += perf.netPnl;
    });
    
    const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(2) : 0;
    
    document.getElementById('win-rate').textContent = `${winRate}%`;
    document.getElementById('total-pnl').textContent = `${totalPnl.toFixed(2)} USDT`;
    
    // Change color based on PnL
    const pnlElement = document.getElementById('total-pnl');
    if (totalPnl > 0) {
        pnlElement.parentElement.parentElement.classList.remove('bg-info', 'bg-danger');
        pnlElement.parentElement.parentElement.classList.add('bg-success');
    } else if (totalPnl < 0) {
        pnlElement.parentElement.parentElement.classList.remove('bg-info', 'bg-success');
        pnlElement.parentElement.parentElement.classList.add('bg-danger');
    } else {
        pnlElement.parentElement.parentElement.classList.remove('bg-danger', 'bg-success');
        pnlElement.parentElement.parentElement.classList.add('bg-info');
    }
}

// Update recent trades table
function updateRecentTradesTable(closedPositions) {
    const tbody = document.getElementById('recent-trades-body');
    tbody.innerHTML = '';
    
    // Sort by closedAt desc
    closedPositions.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
    
    closedPositions.forEach(position => {
        const tr = document.createElement('tr');
        
        const entryPrice = position.entryPrices.length > 0 
            ? (position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length).toFixed(4)
            : 'N/A';
        
        const pnlClass = position.pnlPercent >= 0 ? 'positive' : 'negative';
        const pnlPrefix = position.pnlPercent >= 0 ? '+' : '';
        
        tr.innerHTML = `
            <td>${position.symbol}</td>
            <td>${position.entries > 0 ? 'BUY' : 'SELL'}</td>
            <td>${entryPrice}</td>
            <td>${position.closedPrice ? position.closedPrice.toFixed(4) : 'N/A'}</td>
            <td class="${pnlClass}">${pnlPrefix}${position.pnlPercent ? position.pnlPercent.toFixed(2) : 0}% (${pnlPrefix}${position.pnlAmount ? position.pnlAmount.toFixed(2) : 0} USDT)</td>
            <td>${position.strategyUsed || 'Unknown'}</td>
            <td>${new Date(position.closedAt).toLocaleString()}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Load positions data
async function loadPositionsData() {
    try {
        const response = await fetch('/api/positions');
        
        if (!response.ok) {
            throw new Error('Failed to fetch positions');
        }
        
        const data = await response.json();
        
        // Update active positions table
        updateActivePositionsTable(data.active);
        
        // Update closed positions table
        updateClosedPositionsTable(data.closed);
    } catch (error) {
        console.error('Error loading positions data:', error);
        showError('Failed to load positions data');
    }
}

// Update active positions table
function updateActivePositionsTable(activePositions) {
    const tbody = document.getElementById('active-positions-body');
    tbody.innerHTML = '';
    
    if (activePositions.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" class="text-center">No active positions</td>';
        tbody.appendChild(tr);
        return;
    }
    
    activePositions.forEach(position => {
        const tr = document.createElement('tr');
        tr.classList.add('position-row');
        
        const entryPrice = position.entryPrices.length > 0 
            ? (position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length).toFixed(4)
            : 'N/A';
        
        tr.innerHTML = `
            <td>${position.symbol}</td>
            <td>${position.entries > 0 ? 'BUY' : 'SELL'}</td>
            <td>${entryPrice}</td>
            <td>${position.stopLoss ? position.stopLoss.toFixed(4) : 'N/A'}</td>
            <td>${position.takeProfit ? position.takeProfit.toFixed(4) : 'N/A'}</td>
            <td>${position.strategyUsed || 'Unknown'}</td>
            <td>${new Date(position.createdAt).toLocaleString()}</td>
            <td><button class="btn btn-sm btn-primary view-chart" data-symbol="${position.symbol}">Chart</button></td>
        `;
        
        tbody.appendChild(tr);
    });
    
    // Add event listeners for chart buttons
    document.querySelectorAll('.view-chart').forEach(button => {
        button.addEventListener('click', function() {
            const symbol = this.getAttribute('data-symbol');
            document.getElementById('symbol-input').value = symbol;
            
            // Switch to chart tab
            document.querySelector('a[href="#chart-tab"]').click();
        });
    });
}

// Update closed positions table
function updateClosedPositionsTable(closedPositions) {
    const tbody = document.getElementById('closed-positions-body');
    tbody.innerHTML = '';
    
    if (closedPositions.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="7" class="text-center">No closed positions</td>';
        tbody.appendChild(tr);
        return;
    }
    
    // Sort by closedAt desc
    closedPositions.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
    
    closedPositions.forEach(position => {
        const tr = document.createElement('tr');
        
        const entryPrice = position.entryPrices.length > 0 
            ? (position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length).toFixed(4)
            : 'N/A';
        
        const pnlClass = position.pnlPercent >= 0 ? 'positive' : 'negative';
        const pnlPrefix = position.pnlPercent >= 0 ? '+' : '';
        
        tr.innerHTML = `
            <td>${position.symbol}</td>
            <td>${position.entries > 0 ? 'BUY' : 'SELL'}</td>
            <td>${entryPrice}</td>
            <td>${position.closedPrice ? position.closedPrice.toFixed(4) : 'N/A'}</td>
            <td class="${pnlClass}">${pnlPrefix}${position.pnlPercent ? position.pnlPercent.toFixed(2) : 0}% (${pnlPrefix}${position.pnlAmount ? position.pnlAmount.toFixed(2) : 0} USDT)</td>
            <td>${position.strategyUsed || 'Unknown'}</td>
            <td>${new Date(position.closedAt).toLocaleString()}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Load performance data
async function loadPerformanceData() {
    try {
        const response = await fetch('/api/performance');
        
        if (!response.ok) {
            throw new Error('Failed to fetch performance data');
        }
        
        const data = await response.json();
        
        // Update performance metrics table
        updatePerformanceTable(data);
        
        // Update charts
        updatePerformanceCharts(data);
    } catch (error) {
        console.error('Error loading performance data:', error);
        showError('Failed to load performance data');
    }
}

// Update performance table
function updatePerformanceTable(performanceData) {
    const tbody = document.getElementById('performance-body');
    tbody.innerHTML = '';
    
    if (performanceData.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" class="text-center">No performance data available</td>';
        tbody.appendChild(tr);
        return;
    }
    
    // Sort by winRate desc
    performanceData.sort((a, b) => b.winRate - a.winRate);
    
    performanceData.forEach(item => {
        const tr = document.createElement('tr');
        
        const profitFactorClass = item.profitFactor > 1 ? 'positive' : 'negative';
        const netPnlClass = item.netPnl > 0 ? 'positive' : 'negative';
        const netPnlPrefix = item.netPnl > 0 ? '+' : '';
        
        tr.innerHTML = `
            <td>${item.strategyName}</td>
            <td>${item.symbol}</td>
            <td>${item.totalTrades}</td>
            <td>${item.winRate.toFixed(2)}%</td>
            <td class="${profitFactorClass}">${item.profitFactor.toFixed(2)}</td>
            <td>${item.averageWin.toFixed(2)} USDT</td>
            <td>${item.averageLoss.toFixed(2)} USDT</td>
            <td class="${netPnlClass}">${netPnlPrefix}${item.netPnl.toFixed(2)} USDT</td>
        `;
        
        tbody.appendChild(tr);
    });
}

// Update performance charts
function updatePerformanceCharts(performanceData) {
    // Prepare data for charts
    const strategies = [...new Set(performanceData.map(item => item.strategyName))];
    
    const winRates = strategies.map(strategy => {
        const strategyData = performanceData.filter(item => item.strategyName === strategy);
        const totalTrades = strategyData.reduce((sum, item) => sum + item.totalTrades, 0);
        const winningTrades = strategyData.reduce((sum, item) => sum + item.winningTrades, 0);
        return totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    });
    
    const profitFactors = strategies.map(strategy => {
        const strategyData = performanceData.filter(item => item.strategyName === strategy);
        const totalProfit = strategyData.reduce((sum, item) => sum + item.totalProfit, 0);
        const totalLoss = strategyData.reduce((sum, item) => sum + item.totalLoss, 0);
        return totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
    });
    
    // Win Rate Chart
    const winRateCtx = document.getElementById('win-rate-chart').getContext('2d');
    if (window.winRateChart) window.winRateChart.destroy();
    
    window.winRateChart = new Chart(winRateCtx, {
        type: 'bar',
        data: {
            labels: strategies,
            datasets: [{
                label: 'Win Rate (%)',
                data: winRates,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Win Rate by Strategy'
                },
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Win Rate (%)'
                    }
                }
            }
        }
    });
    
    // Profit Factor Chart
    const profitFactorCtx = document.getElementById('profit-factor-chart').getContext('2d');
    if (window.profitFactorChart) window.profitFactorChart.destroy();
    
    window.profitFactorChart = new Chart(profitFactorCtx, {
        type: 'bar',
        data: {
            labels: strategies,
            datasets: [{
                label: 'Profit Factor',
                data: profitFactors,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Profit Factor by Strategy'
                },
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Profit Factor'
                    }
                }
            }
        }
    });
}

// Load TradingView chart
function loadTradingViewChart() {
    const symbol = document.getElementById('symbol-input').value || 'BTCUSDT';
    const chartContainer = document.getElementById('tradingview-chart');
    
    // Clear chart container
    chartContainer.innerHTML = '';
    
    // Create TradingView widget
    new TradingView.widget({
        "width": '100%',
        "height": 600,
        "symbol": `BINANCE:${symbol}`,
        "interval": "60",
        "timezone": "Etc/UTC",
        "theme": "light",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#f1f3f6",
        "enable_publishing": false,
        "hide_side_toolbar": false,
        "allow_symbol_change": true,
        "container_id": "tradingview-chart"
    });
}

// Show error message
function showError(message) {
    // Implementation depends on your UI library
    console.error(message);
    alert(message);
}