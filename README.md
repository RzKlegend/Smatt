# Smatt

Role-based smart attendance portal with separate dashboards for:

- Admin
- Teacher
- Coordinator
- Student

The app now includes duplicate-mark prevention for attendance:

- minimum confidence threshold
- already-present lock (one mark per student per session)
- per-student cooldown window for repeated recognition events

## Default Users

- admin / admin123
- teacher1 / teacher123
- coordinator1 / coord123
- student1 / student123
- student2 / student123

## Features by Role

- Admin:
	- create/delete batches
	- create/remove users (students, teachers, coordinators)
	- view all attendance sessions and details
- Teacher:
	- start attendance session by batch + subject
	- mark attendance via recognition input
	- view class history
- Coordinator:
	- monitor attendance trends and reports
- Student:
	- view personal attendance summary

## Run

1. Install dependencies:

	 pip install -r requirements.txt

2. Start server:

	 python app.py

3. Open:

	 http://127.0.0.1:5000

## Data Storage

- app data is persisted in data.json
- no external cloud integration is required for this local prototype
