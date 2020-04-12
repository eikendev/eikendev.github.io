var chartId = document.currentScript.getAttribute('data-name');
var ctx = $('#' + chartId);

new Chart(ctx, {
	type: 'bar',
	data: {
		labels: ['Composed', 'Decomposed', 'Composed with vectors', 'Decomposed with vectors'],
		datasets: [{
			label: 'flops per cycle',
			data: [0.5998, 1.8303, 4.8979, 5.5949],
			backgroundColor: [
				'rgba(255, 99, 132, 0.2)',
				'rgba(54, 162, 235, 0.2)',
				'rgba(255, 206, 86, 0.2)',
				'rgba(75, 192, 192, 0.2)',
			],
			borderColor: [
				'rgba(255, 99, 132, 1)',
				'rgba(54, 162, 235, 1)',
				'rgba(255, 206, 86, 1)',
				'rgba(75, 192, 192, 1)',
			],
			borderWidth: 1
		}]
	},
	options: {
		responsive: true,
		maintainAspectRatio: false,
		scales: {
			yAxes: [{
				ticks: {
					beginAtZero: true
				}
			}]
		}
	}
});
