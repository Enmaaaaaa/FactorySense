// ============================================
// FactorySense - JavaScript Application
// Sistema de Monitoreo Industrial IoT con Supabase
// ============================================

// ============================================
// CONFIGURACIÓN DE SUPABASE
// ⚠️ IMPORTANTE: Reemplaza estos valores con tus credenciales reales
// ============================================
const SUPABASE_URL = 'TU_SUPABASE_URL_AQUI';  // Ejemplo: 'https://xxxxx.supabase.co'
const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY_AQUI';  // Tu clave anon/public

// Inicializar cliente Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// VARIABLES GLOBALES
// ============================================
let currentPlantId = null;
let telemetryChart = null;
let refreshInterval = null;
let realtimeChannel = null;

// ============================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Iniciando FactorySense...');
    
    // Verificar que las credenciales estén configuradas
    if (SUPABASE_URL === 'TU_SUPABASE_URL_AQUI') {
        showError('⚠️ CONFIGURACIÓN REQUERIDA: Por favor, edita app.js y configura tus credenciales de Supabase en las líneas 11-12');
        updateConnectionStatus(false);
        return;
    }

    try {
        // Cargar plantas disponibles
        await loadPlants();
        updateConnectionStatus(true);
        
        // Configurar event listeners
        setupEventListeners();
        
        // Inicializar gráfico de Chart.js
        initChart();
        
        // Suscribirse a actualizaciones en tiempo real
        subscribeToRealtimeUpdates();
        
        // Actualización automática cada 10 segundos
        refreshInterval = setInterval(() => {
            if (currentPlantId) {
                refreshDashboard();
            }
        }, 10000);

        console.log('✅ FactorySense inicializado correctamente');

    } catch (error) {
        console.error('❌ Error en la inicialización:', error);
        showError('Error al conectar con la base de datos: ' + error.message);
        updateConnectionStatus(false);
    }
});

// ============================================
// CONFIGURACIÓN DE EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Cambio de planta seleccionada
    document.getElementById('plantSelect').addEventListener('change', handlePlantChange);
    
    // Botones de rango del gráfico
    document.querySelectorAll('.chart-controls button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remover clase active de todos
            document.querySelectorAll('.chart-controls button').forEach(b => {
                b.classList.remove('active');
            });
            // Agregar clase active al botón clickeado
            e.target.classList.add('active');
            
            // Cargar datos según el rango seleccionado
            const range = e.target.dataset.range;
            loadTelemetryData(range);
        });
    });
}

// ============================================
// FUNCIONES DE CARGA DE DATOS
// ============================================

/**
 * Cargar lista de plantas desde Supabase
 */
async function loadPlants() {
    try {
        console.log('📍 Cargando plantas...');
        
        const { data, error } = await supabase
            .from('plants')
            .select('id, name, city, country')
            .order('name');

        if (error) throw error;

        const select = document.getElementById('plantSelect');
        select.innerHTML = '<option value="">Selecciona una planta...</option>';
        
        if (data && data.length > 0) {
            data.forEach(plant => {
                const option = document.createElement('option');
                option.value = plant.id;
                option.textContent = `${plant.name} - ${plant.city}, ${plant.country}`;
                select.appendChild(option);
            });

            // Seleccionar primera planta automáticamente
            select.value = data[0].id;
            await handlePlantChange();
            
            console.log(`✅ ${data.length} planta(s) cargada(s)`);
        } else {
            select.innerHTML = '<option value="">No hay plantas registradas</option>';
            console.warn('⚠️ No se encontraron plantas en la base de datos');
        }
        
    } catch (error) {
        console.error('❌ Error cargando plantas:', error);
        showError('Error cargando plantas: ' + error.message);
    }
}

/**
 * Manejar cambio de planta seleccionada
 */
async function handlePlantChange() {
    const plantId = document.getElementById('plantSelect').value;
    
    if (!plantId) {
        console.log('ℹ️ Ninguna planta seleccionada');
        return;
    }

    console.log('🏭 Cambiando a planta:', plantId);
    currentPlantId = plantId;
    await refreshDashboard();
}

/**
 * Refrescar todo el dashboard
 */
async function refreshDashboard() {
    if (!currentPlantId) return;

    try {
        console.log('🔄 Refrescando dashboard...');
        
        await Promise.all([
            loadMetrics(),
            loadAlerts(),
            loadMachines(),
            loadTelemetryData('1h')
        ]);
        
        hideError();
        
    } catch (error) {
        console.error('❌ Error refrescando dashboard:', error);
        showError('Error al actualizar los datos: ' + error.message);
    }
}

/**
 * Cargar métricas principales del dashboard
 */
async function loadMetrics() {
    try {
        // 1. Obtener todas las máquinas de la planta
        const { data: machines, error: machinesError } = await supabase
            .from('machines')
            .select('id, status')
            .eq('plant_id', currentPlantId);

        if (machinesError) throw machinesError;

        const totalMachines = machines.length;
        const activeMachines = machines.filter(m => m.status === 'ACTIVE').length;

        // Actualizar UI de máquinas
        document.getElementById('totalMachines').textContent = totalMachines;
        document.getElementById('activeMachines').textContent = activeMachines;
        document.getElementById('machineStatus').textContent = 
            activeMachines === totalMachines ? '✓ Todas operativas' : 
            `⚠️ ${totalMachines - activeMachines} inactivas`;

        if (machines.length === 0) {
            document.getElementById('activeSensors').textContent = '0';
            document.getElementById('sensorStatus').textContent = 'Sin sensores';
            document.getElementById('avgTemp').textContent = '--';
            document.getElementById('tempChange').textContent = 'Sin datos';
            document.getElementById('openAlerts').textContent = '0';
            document.getElementById('alertStatus').textContent = 'Sin alertas';
            return;
        }

        const machineIds = machines.map(m => m.id);

        // 2. Obtener sensores de estas máquinas
        const { data: sensors, error: sensorsError } = await supabase
            .from('sensors')
            .select('id, is_active, metric_type')
            .in('machine_id', machineIds);

        if (sensorsError) throw sensorsError;

        const activeSensors = sensors.filter(s => s.is_active).length;
        document.getElementById('activeSensors').textContent = activeSensors;
        document.getElementById('sensorStatus').textContent = `${sensors.length} total`;

        // 3. Calcular temperatura promedio de la última hora
        const tempSensors = sensors.filter(s => s.metric_type === 'temperature');
        const tempSensorIds = tempSensors.map(s => s.id);

        if (tempSensorIds.length > 0) {
            const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
            
            const { data: recentTelemetry, error: telemetryError } = await supabase
                .from('telemetry')
                .select('value')
                .in('sensor_id', tempSensorIds)
                .gte('timestamp', oneHourAgo)
                .order('timestamp', { ascending: false })
                .limit(100);

            if (telemetryError) throw telemetryError;

            if (recentTelemetry && recentTelemetry.length > 0) {
                const avgTemp = recentTelemetry.reduce((sum, t) => sum + t.value, 0) / recentTelemetry.length;
                document.getElementById('avgTemp').textContent = avgTemp.toFixed(1);
                document.getElementById('tempChange').textContent = '📊 Última hora';
            } else {
                document.getElementById('avgTemp').textContent = '--';
                document.getElementById('tempChange').textContent = 'Sin datos recientes';
            }
        } else {
            document.getElementById('avgTemp').textContent = '--';
            document.getElementById('tempChange').textContent = 'Sin sensores de temperatura';
        }

        // 4. Obtener alertas abiertas
        const { data: alerts, error: alertsError } = await supabase
            .from('alerts')
            .select('id, severity')
            .eq('plant_id', currentPlantId)
            .eq('status', 'OPEN');

        if (alertsError) throw alertsError;

        const openAlerts = alerts.length;
        const criticalAlerts = alerts.filter(a => a.severity === 'HIGH').length;
        
        document.getElementById('openAlerts').textContent = openAlerts;
        document.getElementById('alertStatus').textContent = 
            openAlerts > 0 ? 
            (criticalAlerts > 0 ? `🚨 ${criticalAlerts} críticas` : `⚠️ Requiere atención`) : 
            '✓ Sin problemas';

        // Mostrar banner si hay alertas críticas
        if (criticalAlerts > 0) {
            showAlertBanner(`${criticalAlerts} alerta(s) crítica(s) requieren atención inmediata`);
        } else {
            hideAlertBanner();
        }

    } catch (error) {
        console.error('❌ Error cargando métricas:', error);
        throw error;
    }
}

/**
 * Cargar alertas recientes
 */
async function loadAlerts() {
    try {
        const { data: alerts, error } = await supabase
            .from('alerts')
            .select(`
                id,
                severity,
                message,
                value,
                threshold,
                created_at,
                status,
                machines!inner(name)
            `)
            .eq('plant_id', currentPlantId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        const alertsList = document.getElementById('alertsList');
        const alertCountBadge = document.getElementById('alertCountBadge');
        
        const openAlerts = alerts.filter(a => a.status === 'OPEN');
        alertCountBadge.textContent = openAlerts.length;

        if (alerts.length === 0) {
            alertsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✓</div>
                    <p>No hay alertas</p>
                    <p style="font-size: 0.875rem;">Sistema operando normalmente</p>
                </div>
            `;
            return;
        }

        alertsList.innerHTML = alerts.map(alert => {
            const timeAgo = getTimeAgo(new Date(alert.created_at));
            const severityClass = alert.severity === 'MEDIUM' ? 'warning' : '';
            
            return `
                <div class="alert-item ${severityClass}">
                    <div class="alert-item-header">
                        <span class="alert-severity ${alert.severity}">${alert.severity}</span>
                        <span class="alert-time">${timeAgo}</span>
                    </div>
                    <p class="alert-message">${alert.message}</p>
                    <div class="alert-details">
                        <strong>Máquina:</strong> ${alert.machines.name} | 
                        <strong>Valor:</strong> ${alert.value?.toFixed(2) || 'N/A'} | 
                        <strong>Umbral:</strong> ${alert.threshold?.toFixed(2) || 'N/A'}
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('❌ Error cargando alertas:', error);
        throw error;
    }
}

/**
 * Cargar máquinas con sus sensores
 */
async function loadMachines() {
    try {
        const { data: machines, error: machinesError } = await supabase
            .from('machines')
            .select(`
                id,
                name,
                category,
                status,
                sensors(id, metric_type, unit, is_active, hardware_id)
            `)
            .eq('plant_id', currentPlantId)
            .order('name');

        if (machinesError) throw machinesError;

        const machinesGrid = document.getElementById('machinesGrid');

        if (machines.length === 0) {
            machinesGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚙️</div>
                    <p>No hay máquinas registradas en esta planta</p>
                </div>
            `;
            return;
        }

        // Obtener últimas lecturas de todos los sensores
        const sensorIds = machines.flatMap(m => m.sensors.map(s => s.id));
        let latestReadings = {};

        if (sensorIds.length > 0) {
            const tenMinutesAgo = new Date(Date.now() - 600000).toISOString();
            
            const { data: telemetryData, error: telemetryError } = await supabase
                .from('telemetry')
                .select('sensor_id, value, timestamp')
                .in('sensor_id', sensorIds)
                .gte('timestamp', tenMinutesAgo)
                .order('timestamp', { ascending: false });

            if (!telemetryError && telemetryData) {
                // Tomar solo la lectura más reciente por sensor
                telemetryData.forEach(reading => {
                    if (!latestReadings[reading.sensor_id]) {
                        latestReadings[reading.sensor_id] = reading;
                    }
                });
            }
        }

        // Generar HTML de las máquinas
        machinesGrid.innerHTML = machines.map(machine => {
            const sensorsHtml = machine.sensors && machine.sensors.length > 0 ?
                machine.sensors.map(sensor => {
                    const reading = latestReadings[sensor.id];
                    const valueDisplay = reading ? 
                        `${reading.value.toFixed(1)} ${sensor.unit || ''}` : 
                        'Sin datos';
                    const activeClass = sensor.is_active ? 'active' : '';

                    return `
                        <div class="sensor-badge ${activeClass}">
                            <span>${sensor.metric_type}</span>
                            <span class="sensor-value">${valueDisplay}</span>
                        </div>
                    `;
                }).join('') :
                '<span style="color: #6b7280; font-size: 0.875rem;">Sin sensores configurados</span>';

            return `
                <div class="machine-card">
                    <div class="machine-header">
                        <h3 class="machine-name">${machine.name}</h3>
                        <span class="machine-status ${machine.status}">${machine.status}</span>
                    </div>
                    <p class="machine-category">📦 ${machine.category || 'Sin categoría'}</p>
                    <div class="sensors-list">
                        ${sensorsHtml}
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('❌ Error cargando máquinas:', error);
        throw error;
    }
}

/**
 * Cargar datos de telemetría para el gráfico
 */
async function loadTelemetryData(range = '1h') {
    if (!currentPlantId) return;

    try {
        // Calcular timestamp de inicio según el rango
        let startTime;
        switch (range) {
            case '1h':
                startTime = new Date(Date.now() - 3600000); // 1 hora
                break;
            case '24h':
                startTime = new Date(Date.now() - 86400000); // 24 horas
                break;
            case '7d':
                startTime = new Date(Date.now() - 604800000); // 7 días
                break;
            default:
                startTime = new Date(Date.now() - 3600000);
        }

        // 1. Obtener IDs de máquinas de la planta
        const { data: machines, error: machinesError } = await supabase
            .from('machines')
            .select('id')
            .eq('plant_id', currentPlantId);

        if (machinesError) throw machinesError;

        if (machines.length === 0) {
            updateChart([], []);
            return;
        }

        const machineIds = machines.map(m => m.id);

        // 2. Obtener sensores de temperatura activos
        const { data: sensors, error: sensorsError } = await supabase
            .from('sensors')
            .select('id')
            .in('machine_id', machineIds)
            .eq('metric_type', 'temperature')
            .eq('is_active', true);

        if (sensorsError) throw sensorsError;

        if (sensors.length === 0) {
            updateChart([], []);
            return;
        }

        const sensorIds = sensors.map(s => s.id);

        // 3. Obtener telemetría
        const { data: telemetry, error: telemetryError } = await supabase
            .from('telemetry')
            .select('timestamp, value')
            .in('sensor_id', sensorIds)
            .gte('timestamp', startTime.toISOString())
            .order('timestamp', { ascending: true })
            .limit(500);

        if (telemetryError) throw telemetryError;

        if (!telemetry || telemetry.length === 0) {
            updateChart([], []);
            return;
        }

        // 4. Agrupar por timestamp y calcular promedios
        const groupedData = {};
        telemetry.forEach(reading => {
            const timestamp = new Date(reading.timestamp).toISOString();
            if (!groupedData[timestamp]) {
                groupedData[timestamp] = [];
            }
            groupedData[timestamp].push(reading.value);
        });

        // 5. Preparar datos para el gráfico
        const labels = [];
        const values = [];

        Object.keys(groupedData).sort().forEach(timestamp => {
            const avg = groupedData[timestamp].reduce((a, b) => a + b, 0) / groupedData[timestamp].length;
            labels.push(formatTimestamp(new Date(timestamp), range));
            values.push(parseFloat(avg.toFixed(2)));
        });

        updateChart(labels, values);

    } catch (error) {
        console.error('❌ Error cargando telemetría:', error);
        updateChart([], []);
    }
}

// ============================================
// GRÁFICO CON CHART.JS
// ============================================

/**
 * Inicializar el gráfico de Chart.js
 */
function initChart() {
    const ctx = document.getElementById('telemetryChart').getContext('2d');
    
    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Temperatura (°C)',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            family: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        size: 14
                    },
                    bodyFont: {
                        size: 13
                    },
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Tiempo',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Temperatura (°C)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

/**
 * Actualizar datos del gráfico
 */
function updateChart(labels, data) {
    if (!telemetryChart) {
        console.warn('⚠️ Gráfico no inicializado');
        return;
    }

    telemetryChart.data.labels = labels;
    telemetryChart.data.datasets[0].data = data;
    telemetryChart.update('none'); // Sin animación para mejor performance
}

// ============================================
// TIEMPO REAL CON SUPABASE REALTIME
// ============================================

/**
 * Suscribirse a actualizaciones en tiempo real
 */
function subscribeToRealtimeUpdates() {
    console.log('📡 Configurando suscripciones en tiempo real...');
    
    realtimeChannel = supabase
        .channel('factorysense-realtime')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'telemetry'
            },
            (payload) => {
                console.log('📊 Nueva telemetría recibida:', payload.new);
                if (currentPlantId) {
                    // Solo actualizar métricas, no recargar todo
                    loadMetrics();
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'alerts'
            },
            (payload) => {
                console.log('🚨 Nueva alerta recibida:', payload.new);
                if (currentPlantId) {
                    loadAlerts();
                    loadMetrics();
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Suscrito a actualizaciones en tiempo real');
            }
        });
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Mostrar mensaje de error
 */
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
    console.error('❌', message);
}

/**
 * Ocultar mensaje de error
 */
function hideError() {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.classList.remove('show');
}

/**
 * Mostrar banner de alerta crítica
 */
function showAlertBanner(message) {
    const banner = document.getElementById('alertBanner');
    document.getElementById('alertBannerText').textContent = message;
    banner.classList.add('show');
}

/**
 * Ocultar banner de alerta
 */
function hideAlertBanner() {
    const banner = document.getElementById('alertBanner');
    banner.classList.remove('show');
}

/**
 * Actualizar estado de conexión en el header
 */
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connectionStatus');
    const badge = statusElement.parentElement;
    
    if (connected) {
        statusElement.textContent = 'Conectado';
        badge.classList.remove('disconnected');
        console.log('✅ Conexión establecida');
    } else {
        statusElement.textContent = 'Desconectado';
        badge.classList.add('disconnected');
        console.log('❌ Conexión perdida');
    }
}

/**
 * Formatear timestamp según el rango de tiempo
 */
function formatTimestamp(date, range) {
    if (range === '1h' || range === '24h') {
        return date.toLocaleTimeString('es-PE', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } else {
        return date.toLocaleDateString('es-PE', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit'
        });
    }
}

/**
 * Calcular tiempo transcurrido desde una fecha
 */
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Hace unos segundos';
    if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} minuto${Math.floor(seconds / 60) > 1 ? 's' : ''}`;
    if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} hora${Math.floor(seconds / 3600) > 1 ? 's' : ''}`;
    return `Hace ${Math.floor(seconds / 86400)} día${Math.floor(seconds / 86400) > 1 ? 's' : ''}`;
}

// ============================================
// LIMPIEZA AL CERRAR LA PÁGINA
// ============================================
window.addEventListener('beforeunload', () => {
    console.log('🧹 Limpiando recursos...');
    
    // Limpiar interval de refresh
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Desuscribirse de realtime
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }
    
    console.log('👋 FactorySense cerrado');
});