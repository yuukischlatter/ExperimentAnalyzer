#include <napi.h>
#include "thermal_engine.cpp"  // Include the thermal engine
#include <iostream>

// Global engine instance
static ThermalEngine engine;

// Helper function to validate and extract number parameters
double GetNumberParam(const Napi::CallbackInfo& info, int index, const std::string& paramName) {
    if (info.Length() <= index || !info[index].IsNumber()) {
        throw Napi::TypeError::New(info.Env(), paramName + " must be a number");
    }
    return info[index].As<Napi::Number>().DoubleValue();
}

// Helper function to validate and extract string parameters
std::string GetStringParam(const Napi::CallbackInfo& info, int index, const std::string& paramName) {
    if (info.Length() <= index || !info[index].IsString()) {
        throw Napi::TypeError::New(info.Env(), paramName + " must be a string");
    }
    return info[index].As<Napi::String>().Utf8Value();
}

// Load video file
Napi::Value LoadVideo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        // Validate parameters
        if (info.Length() < 1) {
            throw Napi::TypeError::New(env, "Expected 1 argument: video path");
        }
        
        std::string videoPath = GetStringParam(info, 0, "videoPath");
        
        // Load video
        bool success = engine.loadVideo(videoPath);
        
        if (success) {
            std::cout << "Video loaded successfully via Node.js binding" << std::endl;
        } else {
            std::cout << "Failed to load video via Node.js binding" << std::endl;
        }
        
        return Napi::Boolean::New(env, success);
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error loading video: ") + e.what());
    }
}

// Load temperature mapping CSV
Napi::Value LoadTempMapping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        // Validate parameters
        if (info.Length() < 1) {
            throw Napi::TypeError::New(env, "Expected 1 argument: CSV path");
        }
        
        std::string csvPath = GetStringParam(info, 0, "csvPath");
        
        // Load temperature mapping
        bool success = engine.loadTempMapping(csvPath);
        
        if (success) {
            std::cout << "Temperature mapping loaded successfully via Node.js binding" << std::endl;
        } else {
            std::cout << "Failed to load temperature mapping via Node.js binding" << std::endl;
        }
        
        return Napi::Boolean::New(env, success);
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error loading temperature mapping: ") + e.what());
    }
}

// Analyze temperature along a line
Napi::Value AnalyzeLine(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        // Validate parameters: frameNum, x1, y1, x2, y2
        if (info.Length() < 5) {
            throw Napi::TypeError::New(env, "Expected 5 arguments: frameNum, x1, y1, x2, y2");
        }
        
        int frameNum = static_cast<int>(GetNumberParam(info, 0, "frameNum"));
        int x1 = static_cast<int>(GetNumberParam(info, 1, "x1"));
        int y1 = static_cast<int>(GetNumberParam(info, 2, "y1"));
        int x2 = static_cast<int>(GetNumberParam(info, 3, "x2"));
        int y2 = static_cast<int>(GetNumberParam(info, 4, "y2"));
        
        // Validate frame number
        if (frameNum < 0 || frameNum >= engine.getTotalFrames()) {
            throw Napi::RangeError::New(env, "Frame number out of range");
        }
        
        // Analyze line
        std::vector<float> temperatures = engine.analyzeLine(frameNum, x1, y1, x2, y2);
        
        // Convert std::vector<float> to Napi::Array
        Napi::Array result = Napi::Array::New(env, temperatures.size());
        
        for (size_t i = 0; i < temperatures.size(); i++) {
            result[i] = Napi::Number::New(env, temperatures[i]);
        }
        
        return result;
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error analyzing line: ") + e.what());
    }
}

// Get video information
Napi::Value GetVideoInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        auto videoInfo = engine.getVideoInfo();
        
        // Create JavaScript object with video properties
        Napi::Object result = Napi::Object::New(env);
        
        result.Set("frames", Napi::Number::New(env, videoInfo.frames));
        result.Set("fps", Napi::Number::New(env, videoInfo.fps));
        result.Set("width", Napi::Number::New(env, videoInfo.width));
        result.Set("height", Napi::Number::New(env, videoInfo.height));
        result.Set("loaded", Napi::Boolean::New(env, videoInfo.loaded));
        
        return result;
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error getting video info: ") + e.what());
    }
}

// Get temperature for a specific pixel
Napi::Value GetPixelTemperature(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        // Validate parameters: r, g, b
        if (info.Length() < 3) {
            throw Napi::TypeError::New(env, "Expected 3 arguments: r, g, b");
        }
        
        int r = static_cast<int>(GetNumberParam(info, 0, "r"));
        int g = static_cast<int>(GetNumberParam(info, 1, "g"));
        int b = static_cast<int>(GetNumberParam(info, 2, "b"));
        
        // Validate RGB values
        if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
            throw Napi::RangeError::New(env, "RGB values must be between 0 and 255");
        }
        
        float temperature = engine.getPixelTemperature(r, g, b);
        
        if (temperature < 0) {
            return env.Null();  // Return null if no temperature found
        }
        
        return Napi::Number::New(env, temperature);
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error getting pixel temperature: ") + e.what());
    }
}

// Check if engine is ready (video and mapping loaded)
Napi::Value IsReady(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        bool ready = engine.isVideoLoaded() && engine.getTotalFrames() > 0;
        return Napi::Boolean::New(env, ready);
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error checking ready state: ") + e.what());
    }
}

// Get frame data as base64 (optional - for debugging)
Napi::Value GetFrameBase64(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        if (info.Length() < 1) {
            throw Napi::TypeError::New(env, "Expected 1 argument: frameNum");
        }
        
        int frameNum = static_cast<int>(GetNumberParam(info, 0, "frameNum"));
        
        cv::Mat frame = engine.getFrame(frameNum);
        if (frame.empty()) {
            return env.Null();
        }
        
        // Encode frame to JPEG
        std::vector<uchar> buffer;
        std::vector<int> params;
        params.push_back(cv::IMWRITE_JPEG_QUALITY);
        params.push_back(90);
        
        cv::imencode(".jpg", frame, buffer, params);
        
        // Convert to base64
        std::string encoded = "data:image/jpeg;base64,";
        
        const char* chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        size_t len = buffer.size();
        
        for (size_t i = 0; i < len; i += 3) {
            uint32_t val = 0;
            for (int j = 0; j < 3 && i + j < len; j++) {
                val |= buffer[i + j] << (16 - 8 * j);
            }
            
            for (int j = 0; j < 4; j++) {
                if (i * 4 / 3 + j < (len * 4 + 2) / 3) {
                    encoded += chars[(val >> (18 - 6 * j)) & 0x3F];
                } else {
                    encoded += '=';
                }
            }
        }
        
        return Napi::String::New(env, encoded);
        
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("Error getting frame as base64: ") + e.what());
    }
}

// Module initialization - export all functions to Node.js
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    try {
        // Core functions
        exports.Set("loadVideo", Napi::Function::New(env, LoadVideo));
        exports.Set("loadTempMapping", Napi::Function::New(env, LoadTempMapping));
        exports.Set("analyzeLine", Napi::Function::New(env, AnalyzeLine));
        exports.Set("getVideoInfo", Napi::Function::New(env, GetVideoInfo));
        
        // Utility functions
        exports.Set("getPixelTemperature", Napi::Function::New(env, GetPixelTemperature));
        exports.Set("isReady", Napi::Function::New(env, IsReady));
        exports.Set("getFrameBase64", Napi::Function::New(env, GetFrameBase64));
        
        std::cout << "Thermal Engine Node.js binding initialized successfully" << std::endl;
        
        return exports;
        
    } catch (const std::exception& e) {
        std::cerr << "Error initializing Node.js binding: " << e.what() << std::endl;
        throw Napi::Error::New(env, std::string("Failed to initialize binding: ") + e.what());
    }
}

// Register the module
NODE_API_MODULE(thermal_engine, Init)