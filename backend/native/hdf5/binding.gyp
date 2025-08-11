{
  "targets": [
    {
      "target_name": "hdf5_native",
      "sources": [
        "src/hdf5_reader.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "C:/vcpkg/installed/x64-windows/include"
      ],
      "libraries": [
        "C:/vcpkg/installed/x64-windows/lib/hdf5.lib",
        "C:/vcpkg/installed/x64-windows/lib/zlib.lib",
        "C:/vcpkg/installed/x64-windows/lib/aec.lib"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "H5_BUILT_AS_DYNAMIC_LIB"
      ],
      "cflags_cc": [
        "-std=c++17",
        "/EHsc"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17",
            "/EHsc"
          ]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "defines": [
            "_WIN32_WINNT=0x0600"
          ]
        }]
      ]
    }
  ]
}