import os
import cv2
import numpy as np
import face_recognition
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore, storage
from flask import Flask, request, jsonify, send_file
from io import BytesIO
import urllib.request
from datetime import datetime

# Initialize Flask
app = Flask(__name__)

# --- FIREBASE ADMIN SETUP ---
# NOTE: Place your 'serviceAccountKey.json' in the root directory.
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    'storageBucket': 'YOUR_PROJECT_ID.firebasestorage.app'
})
db = firestore.client()
bucket = storage.bucket()

# --- HELPER FUNCTIONS ---

def load_image_from_url(url):
    """Downloads image from Firebase Storage URL and converts to numpy array."""
    resp = urllib.request.urlopen(url)
    image = np.asarray(bytearray(resp.read()), dtype="uint8")
    image = cv2.imdecode(image, cv2.IMREAD_COLOR)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB) # Convert to RGB for face_recognition

# --- ROUTES ---

@app.route('/api/register_student', methods=['POST'])
def register_student():
    """
    FR4: Registers student face.
    Receives: { 'name': str, 'rollNo': str, 'batchId': str, 'imageUrl': str }
    Action: Downloads image, computes encoding, saves to Firestore.
    """
    try:
        data = request.json
        image_url = data['imageUrl']
        
        # 1. Load Image & Encode
        img = load_image_from_url(image_url)
        encodings = face_recognition.face_encodings(img)
        
        if len(encodings) == 0:
            return jsonify({"error": "No face detected in registration photo."}), 400
        
        # Convert encoding to list for JSON storage
        encoding_list = encodings[0].tolist()
        
        # 2. Save to Firestore
        student_ref = db.collection('students').document()
        student_ref.set({
            'name': data['name'],
            'rollNo': data['rollNo'],
            'batchId': data['batchId'],
            'reference_image_url': image_url,
            'face_encoding': encoding_list, # Stored for fast retrieval later
            'created_at': firestore.SERVER_TIMESTAMP
        })
        
        return jsonify({"success": True, "studentId": student_ref.id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/process_attendance', methods=['POST'])
def process_attendance():
    """
    FR9-FR11: Core Logic.
    Receives: { 'batchId': str, 'classPhotoUrl': str, 'subject': str, 'faculty': str }
    Action: Matches classroom faces against students in the Batch.
    """
    try:
        data = request.json
        batch_id = data['batchId']
        class_photo_url = data['classPhotoUrl']
        
        # 1. Fetch Students for this Batch (Optimized: Fetch only necessary fields)
        students_ref = db.collection('students').where('batchId', '==', batch_id).stream()
        
        known_encodings = []
        known_ids = []
        student_map = {} # Map ID to Name/Roll
        
        for doc in students_ref:
            s_data = doc.to_dict()
            if 'face_encoding' in s_data:
                known_encodings.append(np.array(s_data['face_encoding']))
                known_ids.append(doc.id)
                student_map[doc.id] = s_data
        
        if not known_encodings:
            return jsonify({"error": "No students found for this batch."}), 404

        # 2. Process Classroom Photo
        class_img = load_image_from_url(class_photo_url)
        # Optimization: Resize large images for faster processing
        # small_frame = cv2.resize(class_img, (0, 0), fx=0.5, fy=0.5) 
        
        # Detect faces in scene
        face_locations = face_recognition.face_locations(class_img)
        face_encodings = face_recognition.face_encodings(class_img, face_locations)
        
        present_students = []
        
        # 3. Match Faces
        for face_encoding in face_encodings:
            matches = face_recognition.compare_faces(known_encodings, face_encoding, tolerance=0.5)
            face_distances = face_recognition.face_distance(known_encodings, face_encoding)
            
            best_match_index = np.argmin(face_distances)
            if matches[best_match_index]:
                matched_id = known_ids[best_match_index]
                student_info = student_map[matched_id]
                
                # Avoid duplicates
                if student_info not in present_students:
                    present_students.append(student_info)

        # 4. Log Attendance (FR12)
        log_ref = db.collection('attendance_logs').document()
        log_data = {
            'date': datetime.now().strftime("%Y-%m-%d"),
            'time': datetime.now().strftime("%H:%M:%S"),
            'batchId': batch_id,
            'subject': data['subject'],
            'faculty': data['faculty'],
            'present_count': len(present_students),
            'present_students': present_students # Storing full objects for easy reporting
        }
        log_ref.set(log_data)

        return jsonify({
            "success": True,
            "present_students": present_students,
            "logId": log_ref.id
        })

    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

@app.route('/api/download_report', methods=['GET'])
def download_report():
    """
    FR13: Generates Excel Report.
    Query Param: ?logId=xyz
    """
    try:
        log_id = request.args.get('logId')
        log_doc = db.collection('attendance_logs').document(log_id).get()
        
        if not log_doc.exists:
            return "Log not found", 404
            
        data = log_doc.to_dict()
        present_list = data['present_students']
        
        # Prepare Dataframe
        df_data = []
        for p in present_list:
            df_data.append({
                "Roll No": p.get('rollNo', 'N/A'),
                "Name": p.get('name', 'Unknown'),
                "Status": "Present",
                "Timestamp": f"{data['date']} {data['time']}"
            })
            
        df = pd.DataFrame(df_data)
        
        # Create Excel in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Attendance')
            
        output.seek(0)
        
        filename = f"Attendance_{data['batchId']}_{data['date']}.xlsx"
        return send_file(output, download_name=filename, as_attachment=True)
        
    except Exception as e:
        return str(e), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
    #backend