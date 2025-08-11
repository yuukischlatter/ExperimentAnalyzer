// hdf5_reader.cpp - C++ addon using HighFive for real HDF5 data
#include <napi.h>
#include <highfive/H5File.hpp>
#include <highfive/H5DataSet.hpp>
#include <highfive/H5DataSpace.hpp>
#include <highfive/H5Group.hpp>
#include <vector>
#include <string>
#include <map>
#include <iostream>

using namespace HighFive;

class HDF5Reader {
private:
    std::unique_ptr<File> file;
    std::map<std::string, std::map<std::string, std::string>> channelCache;
    
public:
    bool openFile(const std::string& filepath) {
        try {
            file = std::make_unique<File>(filepath, File::ReadOnly);
            std::cout << "✅ Opened HDF5 file: " << filepath << std::endl;
            return true;
        } catch (const std::exception& e) {
            std::cerr << "❌ Error opening file: " << e.what() << std::endl;
            return false;
        }
    }
    
    std::vector<std::string> getChannelIds() {
        std::vector<std::string> channels;
        try {
            auto measurements = file->getGroup("measurements/00000001");
            auto channelsGroup = measurements.getGroup("channels");
            
            // Get all channel IDs
            auto channelNames = channelsGroup.listObjectNames();
            for (const auto& name : channelNames) {
                channels.push_back(name);
            }
            
            std::cout << "📡 Found " << channels.size() << " channels" << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "❌ Error reading channels: " << e.what() << std::endl;
        }
        return channels;
    }
    
    std::map<std::string, std::string> getChannelAttributes(const std::string& channelId) {
        std::map<std::string, std::string> attributes;
        try {
            auto channelGroup = file->getGroup("measurements/00000001/channels/" + channelId);
            
            // Read string attributes
            std::vector<std::string> attrNames = {"name", "physicalUnit", "ChannelName"};
            for (const auto& attrName : attrNames) {
                try {
                    if (channelGroup.hasAttribute(attrName)) {
                        auto attr = channelGroup.getAttribute(attrName);
                        std::string value;
                        attr.read(value);
                        attributes[attrName] = value;
                    }
                } catch (...) {
                    // Ignore failed attribute reads
                }
            }
            
            // Read numeric attributes
            try {
                if (channelGroup.hasAttribute("binToVoltConstant")) {
                    auto attr = channelGroup.getAttribute("binToVoltConstant");
                    double value;
                    attr.read(value);
                    attributes["binToVoltConstant"] = std::to_string(value);
                }
            } catch (...) {}
            
            try {
                if (channelGroup.hasAttribute("binToVoltFactor")) {
                    auto attr = channelGroup.getAttribute("binToVoltFactor");
                    double value;
                    attr.read(value);
                    attributes["binToVoltFactor"] = std::to_string(value);
                }
            } catch (...) {}
            
        } catch (const std::exception& e) {
            std::cerr << "❌ Error reading attributes for " << channelId << ": " << e.what() << std::endl;
        }
        return attributes;
    }
    
    std::vector<std::string> getAvailableDatasets(const std::string& channelId) {
        std::vector<std::string> datasets;
        try {
            auto blockGroup = file->getGroup("measurements/00000001/channels/" + channelId + "/blocks/00000001");
            auto datasetNames = blockGroup.listObjectNames();
            
            for (const auto& name : datasetNames) {
                if (name.find("data") == 0 || name == "raw") {
                    datasets.push_back(name);
                }
            }
            
            std::cout << "📊 Channel " << channelId << " has " << datasets.size() << " datasets" << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "❌ Error reading datasets for " << channelId << ": " << e.what() << std::endl;
        }
        return datasets;
    }
    
    std::vector<double> getDatasetShape(const std::string& channelId, const std::string& datasetName) {
        std::vector<double> shape;
        try {
            auto dataset = file->getDataSet("measurements/00000001/channels/" + channelId + "/blocks/00000001/" + datasetName);
            auto dataspace = dataset.getSpace();
            auto dims = dataspace.getDimensions();
            
            for (auto dim : dims) {
                shape.push_back(static_cast<double>(dim));
            }
            
            std::cout << "📏 Dataset " << datasetName << " shape: ";
            for (auto s : shape) std::cout << static_cast<size_t>(s) << " ";
            std::cout << std::endl;
            
        } catch (const std::exception& e) {
            std::cerr << "❌ Error reading shape for " << datasetName << ": " << e.what() << std::endl;
        }
        return shape;
    }
    
    std::vector<uint16_t> readDatasetChunk(const std::string& channelId, const std::string& datasetName, 
                                          size_t startIdx, size_t count) {
        std::vector<uint16_t> data;
        try {
            auto dataset = file->getDataSet("measurements/00000001/channels/" + channelId + "/blocks/00000001/" + datasetName);
            auto dataspace = dataset.getSpace();
            auto dims = dataspace.getDimensions();
            
            std::cout << "📖 Reading " << count << " samples from " << datasetName 
                      << " starting at " << startIdx << std::endl;
            
            if (dims.size() == 1) {
                // 1D dataset (raw data)
                size_t actualCount = std::min(count, dims[0] - startIdx);
                data.resize(actualCount);
                
                // Create hyperslab selection
                std::vector<size_t> offset = {startIdx};
                std::vector<size_t> countVec = {actualCount};
                
                dataset.select(offset, countVec).read(data);
                
            } else if (dims.size() == 2) {
                // 2D dataset (min/max pairs)
                size_t actualCount = std::min(count, dims[0] - startIdx);
                std::vector<std::vector<uint16_t>> data2d;
                data2d.resize(actualCount);
                for (auto& row : data2d) {
                    row.resize(dims[1]);
                }
                
                // Create hyperslab selection
                std::vector<size_t> offset = {startIdx, 0};
                std::vector<size_t> countVec = {actualCount, dims[1]};
                
                dataset.select(offset, countVec).read(data2d);
                
                // Flatten to 1D for now (take first column)
                data.reserve(actualCount);
                for (const auto& row : data2d) {
                    data.push_back(row[0]);
                }
            }
            
            std::cout << "✅ Read " << data.size() << " values" << std::endl;
            
        } catch (const std::exception& e) {
            std::cerr << "❌ Error reading data chunk: " << e.what() << std::endl;
        }
        return data;
    }
    
    void closeFile() {
        if (file) {
            file.reset();
            std::cout << "📁 Closed HDF5 file" << std::endl;
        }
    }
};

// Global instance
static HDF5Reader g_reader;

// NAPI wrapper functions
Napi::Value OpenFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String filepath expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filepath = info[0].As<Napi::String>().Utf8Value();
    bool success = g_reader.openFile(filepath);
    
    return Napi::Boolean::New(env, success);
}

Napi::Value GetChannelIds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    auto channelIds = g_reader.getChannelIds();
    
    Napi::Array result = Napi::Array::New(env, channelIds.size());
    for (size_t i = 0; i < channelIds.size(); i++) {
        result[i] = Napi::String::New(env, channelIds[i]);
    }
    
    return result;
}

Napi::Value GetChannelAttributes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String channelId expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string channelId = info[0].As<Napi::String>().Utf8Value();
    auto attributes = g_reader.getChannelAttributes(channelId);
    
    Napi::Object result = Napi::Object::New(env);
    for (const auto& [key, value] : attributes) {
        result.Set(key, value);
    }
    
    return result;
}

Napi::Value GetAvailableDatasets(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String channelId expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string channelId = info[0].As<Napi::String>().Utf8Value();
    auto datasets = g_reader.getAvailableDatasets(channelId);
    
    Napi::Array result = Napi::Array::New(env, datasets.size());
    for (size_t i = 0; i < datasets.size(); i++) {
        result[i] = Napi::String::New(env, datasets[i]);
    }
    
    return result;
}

Napi::Value GetDatasetShape(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "channelId and datasetName expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string channelId = info[0].As<Napi::String>().Utf8Value();
    std::string datasetName = info[1].As<Napi::String>().Utf8Value();
    auto shape = g_reader.getDatasetShape(channelId, datasetName);
    
    Napi::Array result = Napi::Array::New(env, shape.size());
    for (size_t i = 0; i < shape.size(); i++) {
        result[i] = Napi::Number::New(env, shape[i]);
    }
    
    return result;
}

Napi::Value ReadDatasetChunk(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 4 || !info[0].IsString() || !info[1].IsString() || 
        !info[2].IsNumber() || !info[3].IsNumber()) {
        Napi::TypeError::New(env, "channelId, datasetName, startIdx, count expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string channelId = info[0].As<Napi::String>().Utf8Value();
    std::string datasetName = info[1].As<Napi::String>().Utf8Value();
    size_t startIdx = info[2].As<Napi::Number>().Uint32Value();
    size_t count = info[3].As<Napi::Number>().Uint32Value();
    
    auto data = g_reader.readDatasetChunk(channelId, datasetName, startIdx, count);
    
    Napi::Array result = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); i++) {
        result[i] = Napi::Number::New(env, data[i]);
    }
    
    return result;
}

Napi::Value CloseFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    g_reader.closeFile();
    return env.Undefined();
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("openFile", Napi::Function::New(env, OpenFile));
    exports.Set("getChannelIds", Napi::Function::New(env, GetChannelIds));
    exports.Set("getChannelAttributes", Napi::Function::New(env, GetChannelAttributes));
    exports.Set("getAvailableDatasets", Napi::Function::New(env, GetAvailableDatasets));
    exports.Set("getDatasetShape", Napi::Function::New(env, GetDatasetShape));
    exports.Set("readDatasetChunk", Napi::Function::New(env, ReadDatasetChunk));
    exports.Set("closeFile", Napi::Function::New(env, CloseFile));
    return exports;
}

NODE_API_MODULE(hdf5_native, Init)